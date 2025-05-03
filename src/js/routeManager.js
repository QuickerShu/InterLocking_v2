class Route {
    constructor(name, lever, destinationButton, points, isAuto = true) {
        this.id = crypto.randomUUID();
        this.name = name;
        this.lever = lever;           // テコの情報 {id: string, type: string}
        this.destination = destinationButton; // 着点ボタンの情報 {id: string}
        this.points = points;         // [{id: string, position: 'normal' | 'reverse'}]
        this.isAuto = isAuto;
        this.isActive = false;
        this.path = points;
    }

    activate() {
        this.points.forEach(point => {
            // ポイントの位置を設定
            const pointElement = document.querySelector(`[data-point-id="${point.id}"]`);
            if (pointElement) {
                // ポイントの状態を変更
                // TODO: 実際のポイント制御の実装
            }
        });
        this.isActive = true;
    }

    deactivate() {
        this.isActive = false;
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            lever: this.lever,
            destination: this.destination,
            points: this.points,
            isAuto: this.isAuto
        };
    }

    static fromJSON(json) {
        const route = new Route(
            json.name,
            json.lever,
            json.destination,
            json.points,
            json.isAuto
        );
        route.id = json.id;
        return route;
    }
}

// 経路探索用のグラフノードクラスを追加
class TrackNode {
    constructor(id) {
        this.id = id;
        this.connections = new Map(); // Map<string, {node: TrackNode, cost: number, position: string}>
    }

    addConnection(node, cost = 1, position = 'normal') {
        this.connections.set(node.id, { node, cost, position });
    }
}

class RouteManager {
    constructor(interlockingManager) {
        this.interlockingManager = interlockingManager;
        this.routes = new Map();
        this.currentMode = 'none';
        this.tempRoute = null;
        this.selectedLever = null;    // 選択されたテコ
        this.selectedDestination = null; // 選択された着点ボタン
        this.trackGraph = new Map(); // Map<string, TrackNode>
        this.maxCandidates = 3;
        this.activeRoutes = new Set();

        this.guidance = document.getElementById('routeGuidance');
        this.modeIndicator = document.getElementById('modeIndicator');
        this.modeText = document.getElementById('modeText');
        this.guidanceSteps = document.getElementById('guidanceSteps');

        this.initializeUI();
        this.bindEvents();
    }

    initializeUI() {
        // ツールバーボタンの参照を取得
        this.autoRouteBtn = document.getElementById('autoRouteBtn');
        this.manualRouteBtn = document.getElementById('manualRouteBtn');
        this.saveRouteBtn = document.getElementById('saveRouteBtn');
        this.loadRouteBtn = document.getElementById('loadRouteBtn');
        this.routeList = document.getElementById('route-list');
    }

    bindEvents() {
        this.autoRouteBtn.addEventListener('click', () => this.toggleAutoMode());
        this.manualRouteBtn.addEventListener('click', () => this.toggleManualMode());
        this.saveRouteBtn.addEventListener('click', () => this.saveRoutes());
        this.loadRouteBtn.addEventListener('click', () => this.loadRoutes());
    }

    toggleAutoMode() {
        if (this.currentMode === 'auto') {
            this.exitAutoMode();
        } else {
            this.enterAutoMode();
        }
    }

    toggleManualMode() {
        if (this.currentMode === 'manual') {
            this.exitManualMode();
        } else {
            this.enterManualMode();
        }
    }

    enterAutoMode() {
        this.currentMode = 'auto';
        this.autoRouteBtn.classList.add('active');
        this.manualRouteBtn.classList.remove('active');
        document.body.style.cursor = 'crosshair';
        // this.updateModeIndicator('auto');

        // 進路候補リストを初期化
        this.routeCandidates = [];

        // window.app.trackManager.tracks から線路リストを取得
        const tracks = window.app.trackManager.tracks;
        const trackElements = Array.isArray(tracks)
            ? tracks
            : Array.from(tracks.values ? tracks.values() : Object.values(tracks));
        // buildTrackGraph用に整形
        const trackElementsForGraph = trackElements.map(track => {
            // connections配列からnormal/reverseを判定してセット
            let normalConnection = null;
            let reverseConnection = null;
            let connectionsArr = Array.isArray(track.connections) ? track.connections : Array.from(track.connections);
            if (Array.isArray(connectionsArr)) {
                connectionsArr.forEach(([endpointIndex, conn]) => {
                    if (endpointIndex === 0) normalConnection = conn;
                    if (endpointIndex === 1) reverseConnection = conn;
                });
            }
            return {
                id: String(track.id),
                type: track.type,
                endpoints: track.endpoints,
                connections: connectionsArr, // 必ず配列で保持
                normalConnection,
                reverseConnection
            };
        });
        console.log('trackElementsForGraph:', trackElementsForGraph);
        trackElementsForGraph.forEach((t, i) => {
            console.log(`track ${i}:`, t);
        });
        // this.buildTrackGraph(trackElementsForGraph); ←この行を削除
        // 端点indexを求める関数（connections優先）
        function getEndpointIndexByConnection(track, targetTrackId) {
            if (!track.connections) return null;
            for (const [fromIdx, conn] of track.connections) {
                if (conn.trackId == targetTrackId) return fromIdx;
            }
            return null;
        }
        function getNearestEndpointIndex(track, x, y) {
            if (!track.endpoints || track.endpoints.length < 2) return 0;
            const d0 = Math.hypot(track.endpoints[0].x - x, track.endpoints[0].y - y);
            const d1 = Math.hypot(track.endpoints[1].x - x, track.endpoints[1].y - y);
            return d0 < d1 ? 0 : 1;
        }

        // デバッグ: levers/destButtonsのendpointIndexを出力
        console.log('levers:', this.interlockingManager.startLevers.map(l => ({id: l.id, trackId: l.trackId, endpointIndex: l.endpointIndex})));
        console.log('destButtons:', this.interlockingManager.destinationButtons.map(b => ({id: b.id, trackId: b.trackId, endpointIndex: b.endpointIndex})));

        // てこ・着点ボタンの全組み合わせで候補生成
        const levers = (this.interlockingManager.startLevers || []).map(l => ({
            id: l.id,
            type: l.type,
            name: l.name || l.id,
            trackId: l.trackId !== undefined && l.trackId !== null ? String(l.trackId) : '',
            endpointIndex: typeof l.endpointIndex === 'number' ? l.endpointIndex : 0,
            x: l.x,
            y: l.y
        }));
        const destButtons = (this.interlockingManager.destinationButtons || []).map(b => ({
            id: b.id,
            name: b.name || b.id,
            trackId: b.trackId !== undefined && b.trackId !== null ? String(b.trackId) : '',
            endpointIndex: typeof b.endpointIndex === 'number' ? b.endpointIndex : 0,
            x: b.x,
            y: b.y
        }));
        console.log('--- 進路自動生成');
        console.log('levers:', levers);
        console.log('destButtons:', destButtons);
        let allCandidates = [];
        levers.forEach(lever => {
            const leverTrack = trackElementsForGraph.find(t => t.id == lever.trackId);
            if (!leverTrack) {
                console.log('[AUTO:SKIP] leverTrackが見つからない:', lever);
                return;
            }
            if (!Array.isArray(leverTrack.endpoints) || leverTrack.endpoints.length !== 2) {
                console.log('[AUTO:SKIP] leverTrackが2端点でない:', leverTrack);
                return;
            }
            // endpointIndexがnullなら両端点を探索
            const leverEpIdxs = (typeof lever.endpointIndex === 'number') ? [lever.endpointIndex] : [0, 1];
            destButtons.forEach(dest => {
                const destTrack = trackElementsForGraph.find(t => t.id == dest.trackId);
                if (!destTrack) {
                    console.log('[AUTO:SKIP] destTrackが見つからない:', dest);
                    return;
                }
                if (!Array.isArray(destTrack.endpoints) || destTrack.endpoints.length !== 2) {
                    console.log('[AUTO:SKIP] destTrackが2端点でない:', destTrack);
                    return;
                }
                const destEpIdxs = (typeof dest.endpointIndex === 'number') ? [dest.endpointIndex] : [0, 1];
                leverEpIdxs.forEach(leverEpIdx => {
                    destEpIdxs.forEach(destEpIdx => {
                        console.log('[AUTO:COMBO]', { lever, dest, leverEpIdx, destEpIdx });
                        const candidates = this._findAllRoutesFromEndpoint(
                            leverTrack, leverEpIdx, dest, destEpIdx
                        ) || [];
                        if (Array.isArray(candidates) && candidates.length > 0) {
                            candidates.forEach(c => {
                                const route = new Route(
                                    `${window.app.getLeverTypeName(lever.type)} ${this.routes.size + 1}`,
                                    lever,
                                    dest,
                                    Array.isArray(c.path) ? c.path : [],
                                    true
                                );
                                allCandidates.push(route);
                            });
                        }
                    });
                });
            });
        });
        allCandidates = allCandidates || [];
        console.log('allCandidates.length:', allCandidates.length);

        // --- 重複排除: leverId+destId+Track列＋分岐器direction列でユニーク化 ---
        const uniqueCandidates = [];
        const seenKeys = new Set();
        (allCandidates || []).forEach(cand => {
            if (!cand) return;
            const pathArr = Array.isArray(cand.path) ? cand.path : [];
            const leverId = cand.lever?.id || cand.lever?.leverId || '';
            const destId = cand.destination?.id || cand.destinationButton?.id || '';
            // Track通過列
            const trackSeq = pathArr.map(p => p.trackId).join('-');
            // 分岐器direction列（directionがあるstepのみ）
            const dirSeq = pathArr
                .filter(p => p.direction)
                .map(p => `${p.trackId}:${p.direction}`).join('-');
            // 重複排除キーにleverIdとdestIdも含める
            const key = leverId + '|' + destId + '|' + trackSeq + '|' + dirSeq;
            if (!seenKeys.has(key)) {
                uniqueCandidates.push(cand);
                seenKeys.add(key);
            }
        });
        allCandidates = uniqueCandidates || [];
        // サイドパネルに候補数・内容を表示
        const panel = document.getElementById('route-candidates-panel');
        if (panel) {
            panel.innerHTML = '';
            // 進路登録ボタン
            const registerBtn = document.createElement('button');
            registerBtn.textContent = '表示中の候補をすべて進路登録';
            registerBtn.className = 'route-register-btn';
            const self = this;
            registerBtn.onclick = function() {
                (allCandidates || []).forEach(route => window.routeManager.addRoute(route));
                if (typeof window.routeManager.updateRouteList === 'function') window.routeManager.updateRouteList();
                panel.innerHTML = '<p>進路候補を登録しました。</p>';
            };
            panel.appendChild(registerBtn);
            // 候補リスト
            panel.appendChild(document.createElement('hr'));
            const countDiv = document.createElement('div');
            countDiv.style.color = 'blue';
            countDiv.textContent = `経路候補数: ${(allCandidates || []).length}`;
            panel.appendChild(countDiv);
            // --- 追加: UI候補リスト内容をデバッグ出力 ---
            console.log('UI候補リスト:', allCandidates.map(r => r.toJSON ? r.toJSON() : r));
            (allCandidates || []).forEach((cand, idx) => {
                if (!cand) return;
                const leverName = cand.lever?.name || cand.lever?.id || '';
                // Routeクラスのdestinationプロパティに合わせて着点名称を取得
                const destName = cand.destination?.name || cand.destination?.id || (cand.destinationButton?.name || cand.destinationButton?.id) || JSON.stringify(cand.destination) || '';
                // 詳細ステップ表記
                const pathArr = Array.isArray(cand.path) ? cand.path : [];
                // --- 詳細なstep情報を表示 ---
                const pathStr = pathArr.map((step, i, arr) => {
                    let track = null;
                    if (window.app && window.app.trackManager) {
                        const tracks = window.app.trackManager.tracks;
                        if (typeof tracks.get === 'function') {
                            track = tracks.get(step.trackId);
                            if (!track && typeof step.trackId === 'string') track = tracks.get(Number(step.trackId));
                            if (!track && typeof step.trackId === 'number') track = tracks.get(String(step.trackId));
                        } else if (typeof tracks === 'object') {
                            track = tracks[step.trackId] || tracks[Number(step.trackId)];
                        }
                    }
                    const name = track ? (track.name || track.id) : step.trackId;
                    // from/to端点
                    let from = (typeof step.fromEpIdx === 'number') ? step.fromEpIdx : (typeof step.from === 'number' ? step.from : null);
                    let to = (typeof step.toEpIdx === 'number') ? step.toEpIdx : (typeof step.to === 'number' ? step.to : null);
                    // direction
                    let dir = step.direction;
                    let dirLabel = '';
                    if (dir) {
                        if (dir === 'normal') dirLabel = '直進';
                        else if (dir === 'reverse') dirLabel = '分岐';
                        else if (dir === 'straight') dirLabel = '直進';
                        else if (dir === 'cross') dirLabel = 'クロス';
                        else dirLabel = dir;
                    }
                    // 詳細step表記
                    let epStr = '';
                    const fromStr = (from !== null && from !== undefined) ? from : '-';
                    const toStr = (to !== null && to !== undefined) ? to : '-';
                    if (from != null && to != null) {
                        epStr = `[端点${fromStr}→${toStr}` + (dirLabel ? `:${dirLabel}` : '') + ']';
                    } else if (to != null) {
                        epStr = `[→端点${toStr}` + (dirLabel ? `:${dirLabel}` : '') + ']';
                    } else {
                        epStr = dirLabel ? `[${dirLabel}]` : '';
                    }
                    return `${name}${epStr}`;
                }).join(' <span style="color:#888">→</span> ');
                const div = document.createElement('div');
                div.style.margin = '4px 0';
                div.innerHTML = `<b>#${idx + 1}</b> てこ: ${leverName} → 着点: ${destName}<br>経路: ${pathStr}`;
                // 削除ボタン
                const delBtn = document.createElement('button');
                delBtn.textContent = '削除';
                delBtn.className = 'route-delete-btn';
                delBtn.onclick = (e) => {
                    (allCandidates || []).splice(idx, 1);
                    this.generateAutoRoute(); // 再描画
                    e.stopPropagation();
                };
                div.appendChild(delBtn);
                panel.appendChild(div);
            });
        }

        // 進路候補をUIに反映
        this.routeCandidates = allCandidates;

        // 追加: 候補として残った経路の繋がりをデバッグログで出力
        allCandidates.forEach((candidate, idx) => {
            console.debug(`[経路候補${idx+1}]`);
            (candidate.path || []).forEach((step, stepIdx) => {
                console.debug(`  step${stepIdx}: trackId=${step.trackId}, fromEpIdx=${step.fromEpIdx}, toEpIdx=${step.toEpIdx}, type=${step.type}, direction=${step.direction}`);
            });
        });
    }

    // 進路自動生成（経路候補列挙＋重複排除＋UI表示）
    generateAutoRoute() {
        // ...（既存のgenerateAutoRoute本体をここに必ず含める）...
    }

    /**
     * leverTrack, leverEpIdx, dest, destEpIdx から経路候補を列挙（詳細記録付きBFS）
     * @returns {Array} 経路候補配列
     */
    _findAllRoutesFromEndpoint(leverTrack, leverEpIdx, dest, destEpIdx) {
        const tracks = window.app.trackManager.tracks;
        const allTracks = Array.isArray(tracks)
            ? tracks
            : Array.from(tracks.values ? tracks.values() : Object.values(tracks));
        const queue = [];
        const results = [];
        queue.push({
            track: leverTrack,
            epIdx: leverEpIdx,
            path: [{
                trackId: leverTrack.id,
                fromEpIdx: null,
                toEpIdx: leverEpIdx,
                type: leverTrack.type,
                via: 'start',
                isPoint: leverTrack.isPoint
            }],
            visitedSteps: new Set([`${leverTrack.id}:null:${leverEpIdx}`]),
            visitedTrackIdsInternalMove: new Set(), // track内移動履歴
            visitedTrackInternalMove: new Set() // track内移動履歴
        });
        while (queue.length > 0) {
            const node = queue.shift();
            let skipped = false; // 追加: スキップ理由記録用
            // 探索状況を出力
            console.debug(`[探索状況] 現在: trackId=${node.track.id}, epIdx=${node.epIdx}, path=`, node.path.map(s => `${s.trackId}(${s.fromEpIdx}->${s.toEpIdx})`).join('→'));
            if (String(node.track.id) === String(dest.trackId) && node.epIdx === destEpIdx) {
                results.push({ path: node.path });
                continue;
            }
            const endpoints = Array.isArray(node.track.endpoints) ? node.track.endpoints : [];
            let anyTrackMove = false;
            for (let nextEpIdx = 0; nextEpIdx < endpoints.length; nextEpIdx++) {
                if (nextEpIdx === node.epIdx) continue;
                // 2端点trackの場合は、nextEpIdx = 1 - node.epIdx のみ許可
                if (endpoints.length === 2 && nextEpIdx !== (1 - node.epIdx)) continue;
                const stepKey = `${node.track.id}:${node.epIdx}:${nextEpIdx}`;
                // track内移動で通過したtrackIdの再通過禁止
                if (node.visitedTrackIdsInternalMove && node.visitedTrackIdsInternalMove.has(node.track.id)) {
                    console.debug(`[SKIP:visitedTrackIdsInternalMove] trackId=${node.track.id}（track内移動再通過禁止）`);
                    skipped = `[SKIP:visitedTrackIdsInternalMove] trackId=${node.track.id}`;
                    continue;
                }
                if (node.visitedSteps.has(stepKey)) {
                    console.debug(`[SKIP:visitedSteps] trackId=${node.track.id} from=${node.epIdx} to=${nextEpIdx}（端点ペア再通過禁止）`);
                    skipped = `[SKIP:visitedSteps] trackId=${node.track.id} from=${node.epIdx} to=${nextEpIdx}`;
                    continue;
                }
                if (node.visitedTrackInternalMove && node.visitedTrackInternalMove.has(node.track.id)) {
                    console.debug(`[SKIP:visitedTrackInternalMove] trackId=${node.track.id}（track内移動1回制限）`);
                    skipped = `[SKIP:visitedTrackInternalMove] trackId=${node.track.id}`;
                    continue;
                }
                let addVisitedTrackIdInternalMove = false;
                if (node.track.type === 'double_cross' || node.track.type === 'double_slip_x') {
                    const stepKey = `${node.track.id}:${node.epIdx}:${nextEpIdx}`;
                    if (node.visitedSteps.has(stepKey)) {
                        console.debug(`[SKIP:visitedSteps(double_cross)] trackId=${node.track.id} from=${node.epIdx} to=${nextEpIdx}（多端点track端点ペア再通過禁止）`);
                        skipped = `[SKIP:visitedSteps(double_cross)] trackId=${node.track.id} from=${node.epIdx} to=${nextEpIdx}`;
                        continue;
                    }
                    if (node.visitedTrackIdsInternalMove && node.visitedTrackIdsInternalMove.has(node.track.id)) {
                        console.debug(`[SKIP:visitedTrackIdsInternalMove] trackId=${node.track.id}（多端点trackId再通過禁止）`);
                        skipped = `[SKIP:visitedTrackIdsInternalMove] trackId=${node.track.id}`;
                        continue;
                    }
                    addVisitedTrackIdInternalMove = true;
                } else if (endpoints.length === 2) {
                    const lastStep = node.path[node.path.length - 1];
                    if (lastStep && lastStep.trackId === node.track.id && lastStep.fromEpIdx !== null && lastStep.toEpIdx !== null) {
                        if ((lastStep.fromEpIdx === nextEpIdx && lastStep.toEpIdx === node.epIdx) || (lastStep.fromEpIdx === node.epIdx && lastStep.toEpIdx === nextEpIdx)) {
                            addVisitedTrackIdInternalMove = true;
                        }
                    }
                    if (node.visitedTrackIdsInternalMove && node.visitedTrackIdsInternalMove.has(node.track.id)) {
                        console.debug(`[SKIP:visitedTrackIdsInternalMove] trackId=${node.track.id}（2端点trackId再通過禁止）`);
                        skipped = `[SKIP:visitedTrackIdsInternalMove] trackId=${node.track.id}`;
                        continue;
                    }
                }
                let direction = undefined;
                if (node.track.isPoint && typeof node.epIdx === 'number' && typeof nextEpIdx === 'number') {
                    if (node.track.type === 'point_left' || node.track.type === 'point_right') {
                        if ((node.epIdx === 0 && nextEpIdx === 1) || (node.epIdx === 1 && nextEpIdx === 0)) direction = 'normal';
                        else if ((node.epIdx === 0 && nextEpIdx === 2) || (node.epIdx === 2 && nextEpIdx === 0)) direction = 'reverse';
                    }
                    if (node.track.type === 'double_cross' || node.track.type === 'double_slip_x') {
                        if ((node.epIdx === 0 && nextEpIdx === 1) || (node.epIdx === 1 && nextEpIdx === 0) || (node.epIdx === 2 && nextEpIdx === 3) || (node.epIdx === 3 && nextEpIdx === 2)) direction = 'straight';
                        else if ((node.epIdx === 0 && nextEpIdx === 3) || (node.epIdx === 3 && nextEpIdx === 0) || (node.epIdx === 1 && nextEpIdx === 2) || (node.epIdx === 2 && nextEpIdx === 1)) direction = 'cross';
                    }
                }
                // track内移動時のみvisitedStepsにstepKeyを追加
                const newVisitedSteps = new Set(node.visitedSteps);
                newVisitedSteps.add(stepKey);
                const newVisitedTrackInternalMove = new Set(node.visitedTrackInternalMove);
                newVisitedTrackInternalMove.add(node.track.id);
                // track内移動で通過した場合のみvisitedTrackIdsInternalMoveにtrackIdを追加
                let newVisitedTrackIdsInternalMove = new Set(node.visitedTrackIdsInternalMove);
                if (addVisitedTrackIdInternalMove) {
                    newVisitedTrackIdsInternalMove.add(node.track.id);
                }
                // track間移動で入ったtrackIdはここでは追加しない
                let newVisitedTrackIdsByConnection = new Set(node.visitedTrackIdsByConnection);
                queue.push({
                    track: node.track,
                    epIdx: nextEpIdx,
                    path: node.path.concat({
                        trackId: node.track.id,
                        fromEpIdx: node.epIdx,
                        toEpIdx: nextEpIdx,
                        type: node.track.type,
                        via: 'track',
                        isPoint: node.track.isPoint,
                        direction: direction !== undefined ? direction : null
                    }),
                    visitedSteps: newVisitedSteps,
                    visitedTrackIdsInternalMove: newVisitedTrackIdsInternalMove,
                    visitedTrackIdsByConnection: newVisitedTrackIdsByConnection,
                    visitedTrackInternalMove: newVisitedTrackInternalMove
                });
                // 追加: track内移動の進み先を出力
                console.debug(`[探索状況] track内移動: trackId=${node.track.id}, fromEpIdx=${node.epIdx} → toEpIdx=${nextEpIdx}`);
                anyTrackMove = true;
            }
            let connectionsArr = Array.isArray(node.track.connections) ? node.track.connections : Array.from(node.track.connections);
            let anyConnectionMove = false;
            for (const [fromIdx, conn] of connectionsArr) {
                if (Number(fromIdx) !== node.epIdx) continue;
                const nextTrack = allTracks.find(t => String(t.id) === String(conn.trackId));
                if (!nextTrack) continue;
                // track間移動で入ったtrackIdの再入場禁止
                if (node.visitedTrackIdsByConnection && node.visitedTrackIdsByConnection.has(nextTrack.id)) {
                    console.debug(`[SKIP:visitedTrackIdsByConnection] nextTrackId=${nextTrack.id}（track間移動再入場禁止）`);
                    skipped = `[SKIP:visitedTrackIdsByConnection] nextTrackId=${nextTrack.id}`;
                    continue;
                }
                let direction = undefined;
                if (nextTrack.isPoint && typeof conn.endpointIndex === 'number' && typeof node.epIdx === 'number') {
                    if (nextTrack.type === 'point_left' || nextTrack.type === 'point_right') {
                        if ((conn.endpointIndex === 0 && node.epIdx === 1) || (conn.endpointIndex === 1 && node.epIdx === 0)) direction = 'normal';
                        else if ((conn.endpointIndex === 0 && node.epIdx === 2) || (conn.endpointIndex === 2 && node.epIdx === 0)) direction = 'reverse';
                    }
                    if (nextTrack.type === 'double_cross' || nextTrack.type === 'double_slip_x') {
                        if ((conn.endpointIndex === 0 && node.epIdx === 1) || (conn.endpointIndex === 1 && node.epIdx === 0) || (conn.endpointIndex === 2 && node.epIdx === 3) || (conn.endpointIndex === 3 && node.epIdx === 2)) direction = 'straight';
                        else if ((conn.endpointIndex === 0 && node.epIdx === 3) || (conn.endpointIndex === 3 && node.epIdx === 0) || (conn.endpointIndex === 1 && node.epIdx === 2) || (conn.endpointIndex === 2 && node.epIdx === 1)) direction = 'cross';
                    }
                }
                // track間移動時はvisitedStepsをそのままコピー
                const newVisitedSteps = new Set(node.visitedSteps);
                // track間移動で入ったtrackIdをvisitedTrackIdsByConnectionに追加
                const newVisitedTrackIdsByConnection = new Set(node.visitedTrackIdsByConnection);
                newVisitedTrackIdsByConnection.add(nextTrack.id);
                // track内移動で通過したtrackIdはそのままコピー
                const newVisitedTrackIdsInternalMove = new Set(node.visitedTrackIdsInternalMove);
                queue.push({
                    track: nextTrack,
                    epIdx: conn.endpointIndex,
                    path: node.path.concat({
                        trackId: nextTrack.id,
                        fromEpIdx: node.epIdx,
                        toEpIdx: conn.endpointIndex,
                        type: nextTrack.type,
                        via: 'connection',
                        isPoint: nextTrack.isPoint,
                        direction: direction !== undefined ? direction : null
                    }),
                    visitedSteps: newVisitedSteps,
                    visitedTrackIdsInternalMove: newVisitedTrackIdsInternalMove,
                    visitedTrackIdsByConnection: newVisitedTrackIdsByConnection,
                    visitedTrackInternalMove: new Set(node.visitedTrackInternalMove)
                });
                // 追加: track間移動の進み先を出力
                console.debug(`[探索状況] track間移動: fromTrackId=${node.track.id}, fromEpIdx=${node.epIdx} → toTrackId=${nextTrack.id}, toEpIdx=${conn.endpointIndex}`);
                anyConnectionMove = true;
            }
            // 追加: このnodeからtrack内・track間ともに進めなかった場合、途絶情報を出力
            if (!anyTrackMove && !anyConnectionMove) {
                console.debug(`[DEADEND] 経路途絶: trackId=${node.track.id}, epIdx=${node.epIdx}, path=`, node.path.map(s => `${s.trackId}(${s.fromEpIdx}->${s.toEpIdx})`).join('→'), skipped ? `最後のスキップ理由: ${skipped}` : '');
            }
        }
        return results;
    }

    /**
     * 進路(Route)を登録する
     * @param {Route} route
     */
    addRoute(route) {
        if (!this.routes || typeof this.routes.set !== 'function') {
            this.routes = new Map();
        }
        if (!route.id) {
            route.id = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : (Date.now() + '_' + Math.floor(Math.random() * 10000));
        }
        this.routes.set(route.id, route);
    }

    /**
     * 登録済み進路一覧をUIに表示
     */
    updateRouteList() {
        if (!this.routeList) return;
        this.routeList.innerHTML = '';
        const routes = Array.from(this.routes.values());
        if (routes.length === 0) {
            this.routeList.innerHTML = '<div style="color:gray;">登録された進路はありません</div>';
            return;
        }
        routes.forEach((route, idx) => {
            const div = document.createElement('div');
            div.className = 'route-item';
            const leverName = route.lever?.name || route.lever?.id || '';
            const destName = route.destination?.name || route.destination?.id || '';
            div.innerHTML = `
                <div class="route-header">
                    <span class="route-name">${route.name || `進路${idx+1}`}</span>
                    <span class="route-generation-mode ${route.isAuto ? 'auto' : 'manual'}">${route.isAuto ? '自動' : '手動'}</span>
                </div>
                <div class="route-details">
                    てこ: ${leverName} → 着点: ${destName}
                </div>
            `;
            // 開通ボタン
            const openBtn = document.createElement('button');
            openBtn.textContent = '開通';
            openBtn.className = 'route-action-btn';
            openBtn.onclick = () => {
                if (typeof this.activateRoute === 'function') {
                    this.activateRoute(route.id);
                }
            };
            div.appendChild(openBtn);
            // 削除ボタン
            const delBtn = document.createElement('button');
            delBtn.textContent = '削除';
            delBtn.className = 'route-action-btn delete';
            delBtn.onclick = () => {
                this.routes.delete(route.id);
                this.updateRouteList();
            };
            div.appendChild(delBtn);
            this.routeList.appendChild(div);
        });
    }

    /**
     * 指定した進路を開通させる
     * @param {string} routeId
     */
    activateRoute(routeId) {
        const route = this.routes.get(routeId);
        if (!route) return;
        // デバッグ: てこtrackId, 経路stepのtrackId一覧
        const leverTrackId = route.lever?.trackId;
        console.log('[DEBUG] てこtrackId:', leverTrackId);
        const stepTrackIds = (route.points || []).map(s => s.trackId);
        console.log('[DEBUG] 経路stepのtrackId一覧:', stepTrackIds);
        // まず全進路を解除（単純化のため）
        this.routes.forEach(r => { if (r.isActive) this.deactivateRoute(r.id); });
        // 経路上のTrackを進路色・分岐器directionに
        (route.points || []).forEach((step, idx, arr) => {
            let track = null;
            if (window.app && window.app.trackManager) {
                const tracks = window.app.trackManager.tracks;
                if (typeof tracks.get === 'function') {
                    track = tracks.get(step.trackId);
                    if (!track && typeof step.trackId === 'string') track = tracks.get(Number(step.trackId));
                    if (!track && typeof step.trackId === 'number') track = tracks.get(String(step.trackId));
                } else if (typeof tracks === 'object') {
                    track = tracks[step.trackId] || tracks[Number(step.trackId)];
                }
            }
            console.log(`[DEBUG] stepIdx=${idx} step.trackId=${step.trackId} track=`, track);
            if (!track) {
                console.warn(`[DEBUG] trackId=${step.trackId} のtrackが取得できません`);
                return;
            }
            // 線路色: 進路中
            if (track.type === 'double_cross') {
                // ここでstatusMapを一度リセット
                track.clearAllPairStatus();
                // step間でfrom→toペアのみROUTEにする
                for (let i = 0; i < arr.length - 1; i++) {
                    const curr = arr[i];
                    const next = arr[i + 1];
                    if (curr.trackId == track.id && next.trackId == track.id) {
                        track.setPairStatus(curr.toEpIdx, next.toEpIdx, 'ROUTE');
                        console.log(`[DEBUG] double_cross setPairStatus: ${curr.toEpIdx}->${next.toEpIdx} をROUTEに`);
                    }
                }
            } else {
                track.status = 'ROUTE';
            }
            console.log(`[DEBUG] trackId=${step.trackId} のstatusをROUTEに設定`, track);
            // デバッグ: てこtrackIdと一致する場合は明示的に出力
            if (String(step.trackId) === String(leverTrackId)) {
                console.log(`[DEBUG] てこtrackId(${leverTrackId})と一致: stepIdx=${idx}, track=`, track);
            }
            // 分岐器・ダブルクロス等のdirection自動判定
            if (track.isPoint) {
                const from = step.fromEpIdx;
                const to = step.toEpIdx;
                if (track.type === 'point_left' || track.type === 'point_right') {
                    if ((from === 0 && to === 1) || (from === 1 && to === 0)) track.pointDirection = 'normal';
                    else if ((from === 0 && to === 2) || (from === 2 && to === 0)) track.pointDirection = 'reverse';
                } else if (track.type === 'double_cross' || track.type === 'double_slip_x') {
                    if ((from === 0 && to === 1) || (from === 1 && to === 0) || (from === 2 && to === 3) || (from === 3 && to === 2)) track.pointDirection = 'straight';
                    else if ((from === 0 && to === 3) || (from === 3 && to === 0) || (from === 1 && to === 2) || (from === 2 && to === 1)) track.pointDirection = 'cross';
                }
            }
        });
        route.isActive = true;
        if (window.app && window.app.canvas) window.app.canvas.draw();
    }

    /**
     * 指定した進路を解除する
     * @param {string} routeId
     */
    deactivateRoute(routeId) {
        const route = this.routes.get(routeId);
        if (!route) return;
        (route.points || []).forEach((step) => {
            let track = null;
            if (window.app && window.app.trackManager) {
                const tracks = window.app.trackManager.tracks;
                if (typeof tracks.get === 'function') {
                    track = tracks.get(step.trackId);
                } else if (typeof tracks === 'object') {
                    track = tracks[step.trackId] || tracks[Number(step.trackId)];
                }
            }
            if (!track) return;
            // 線路色: 通常
            if (track.type === 'double_cross') {
                track.setPairStatus(step.fromEpIdx, step.toEpIdx, 'normal');
            } else {
                track.status = 'normal';
            }
            // 分岐器等のdirectionも元に戻す（ここでは初期値に）
            if (track.isPoint) {
                if (track.type === 'point_left' || track.type === 'point_right') track.pointDirection = 'normal';
                else if (track.type === 'double_cross' || track.type === 'double_slip_x') track.pointDirection = 'straight';
            }
        });
        route.isActive = false;
        if (window.app && window.app.canvas) window.app.canvas.draw();
    }
}



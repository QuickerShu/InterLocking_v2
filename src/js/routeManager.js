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
        // alert('fromJSON called');
        // console.error('!!! fromJSON called !!!', json);
        try {
            // console.log('[fromJSON] 入力:', json);
            // if (json && Array.isArray(json.points)) {
            //     console.log('[fromJSON] points内容:', JSON.stringify(json.points, null, 2));
            // } else {
            //     console.log('[fromJSON] pointsが配列でない:', json ? json.points : json);
            // }
            // 許可ペア
            const validPairs = [
                [0,1],[1,0],[2,3],[3,2],[0,3],[3,0],[1,2],[2,1]
            ];
            // pointsをフィルタ
            const filteredPoints = (json.points || []).filter(pt => {
                if ((pt.type === 'double_cross' || pt.type === 'double_slip_x') && typeof pt.fromEpIdx === 'number' && typeof pt.toEpIdx === 'number') {
                    return validPairs.some(([a,b]) => a === pt.fromEpIdx && b === pt.toEpIdx);
                }
                return true;
            });
            // console.log('[fromJSON] filteredPoints:', JSON.stringify(filteredPoints, null, 2));
            const route = new Route(
                json.name,
                json.lever,
                json.destination,
                filteredPoints,
                json.isAuto
            );
            route.id = json.id;
            // console.log('[fromJSON] 生成route:', route);
            // console.log('[fromJSON] return前 route:', route);
            return route;
        } catch (e) {
            // console.log('catch!');
            // console.error('[Route.fromJSON例外]', e, json);
            // if (json && Array.isArray(json.points)) {
            //     console.log('[catch] points内容:', JSON.stringify(json.points, null, 2));
            // } else {
            //     console.log('[catch] pointsが配列でない:', json ? json.points : json);
            // }
            return null;
        }
    }

    isSatisfied() {
        // 進路上の各trackの分岐方向や状態が現在の線路状態と一致しているか判定
        if (!window.app || !window.app.trackManager) return false;
        const tracks = window.app.trackManager.tracks;
        for (const step of this.points || []) {
            let track = null;
            if (typeof tracks.get === 'function') {
                track = tracks.get(step.trackId) || tracks.get(Number(step.trackId));
            } else if (typeof tracks === 'object') {
                track = tracks[step.trackId] || tracks[Number(step.trackId)];
            } else if (Array.isArray(tracks)) {
                track = tracks.find(t => String(t.id) === String(step.trackId));
            }
            if (!track) return false;
            // 分岐器・ダブルクロス・ダブルスリップはdirectionも比較
            if (track.isPoint || track.type === 'double_cross' || track.type === 'double_slip_x') {
                // step.directionが指定されていれば比較
                if (step.direction && track.pointDirection && step.direction !== track.pointDirection) {
                    return false;
                }
            }
            // 他にも必要な整合性判定があればここに追加
        }
        return true;
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
        // 既存進路がある場合は警告
        if (this.currentMode !== 'auto' && this.routes && this.routes.size > 0) {
            const ok = window.confirm('既存の進路を消去して自動生成しますか？');
            if (!ok) return;
            this.clearRoutes();
        }
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
        // console.log('trackElementsForGraph:', trackElementsForGraph);
        trackElementsForGraph.forEach((t, i) => {
            // console.log(`track ${i}:`, t);
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
        // console.log('levers:', this.interlockingManager.startLevers.map(l => ({id: l.id, trackId: l.trackId, endpointIndex: l.endpointIndex})));
        // console.log('destButtons:', this.interlockingManager.destinationButtons.map(b => ({id: b.id, trackId: b.trackId, endpointIndex: b.endpointIndex})));

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
        // console.log('--- 進路自動生成');
        // console.log('levers:', levers);
        // console.log('destButtons:', destButtons);
        let allCandidates = [];
        levers.forEach(lever => {
            const leverTrack = trackElementsForGraph.find(t => t.id == lever.trackId);
            if (!leverTrack) {
                // console.log('[AUTO:SKIP] leverTrackが見つからない:', lever);
                return;
            }
            if (!Array.isArray(leverTrack.endpoints) || leverTrack.endpoints.length !== 2) {
                // console.log('[AUTO:SKIP] leverTrackが2端点でない:', leverTrack);
                return;
            }
            // endpointIndexがnullなら両端点を探索
            const leverEpIdxs = (typeof lever.endpointIndex === 'number') ? [lever.endpointIndex] : [0, 1];
            destButtons.forEach(dest => {
                const destTrack = trackElementsForGraph.find(t => t.id == dest.trackId);
                if (!destTrack) {
                    // console.log('[AUTO:SKIP] destTrackが見つからない:', dest);
                    return;
                }
                if (!Array.isArray(destTrack.endpoints) || destTrack.endpoints.length !== 2) {
                    // console.log('[AUTO:SKIP] destTrackが2端点でない:', destTrack);
                    return;
                }
                const destEpIdxs = (typeof dest.endpointIndex === 'number') ? [dest.endpointIndex] : [0, 1];
                leverEpIdxs.forEach(leverEpIdx => {
                    destEpIdxs.forEach(destEpIdx => {
                        // console.log('[AUTO:COMBO]', { lever, dest, leverEpIdx, destEpIdx });
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
        // console.log('allCandidates.length:', allCandidates.length);

        // lever.trackIdとdestination.trackIdが一致する進路候補は除外
        allCandidates = allCandidates.filter(cand => {
            if (!cand || !cand.lever || !cand.destination) return true;
            return String(cand.lever.trackId) !== String(cand.destination.trackId);
        });

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
                // 進路登録後に自動モードを終了
                if (typeof window.routeManager.exitAutoMode === 'function') {
                    window.routeManager.exitAutoMode();
                }
            };
            panel.appendChild(registerBtn);
            // 候補リスト
            panel.appendChild(document.createElement('hr'));
            const countDiv = document.createElement('div');
            countDiv.style.color = 'blue';
            countDiv.textContent = `経路候補数: ${(allCandidates || []).length}`;
            panel.appendChild(countDiv);
            // --- 追加: UI候補リスト内容をデバッグ出力 ---
            // console.log('UI候補リスト:', allCandidates.map(r => r.toJSON ? r.toJSON() : r));
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
        // --- 追加: 候補が0件ならワーニングを出して自動モード終了 ---
        if (!allCandidates || allCandidates.length === 0) {
            alert('経路候補が見つかりませんでした。条件を見直してください。');
            if (typeof this.exitAutoMode === 'function') {
                this.exitAutoMode();
            }
            return;
        }

        // 追加: 候補として残った経路の繋がりをデバッグログで出力
        allCandidates.forEach((candidate, idx) => {
            // console.debug(`[経路候補${idx+1}]`);
            (candidate.path || []).forEach((step, stepIdx) => {
                // console.debug(`  step${stepIdx}: trackId=${step.trackId}, fromEpIdx=${step.fromEpIdx}, toEpIdx=${step.toEpIdx}, type=${step.type}, direction=${step.direction}`);
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
            // console.debug(`[探索状況] 現在: trackId=${node.track.id}, epIdx=${node.epIdx}, path=`, node.path.map(s => `${s.trackId}(${s.fromEpIdx}->${s.toEpIdx})`).join('→'));
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
                    // console.debug(`[SKIP:visitedTrackIdsInternalMove] trackId=${node.track.id}（track内移動再通過禁止）`);
                    skipped = `[SKIP:visitedTrackIdsInternalMove] trackId=${node.track.id}`;
                    continue;
                }
                if (node.visitedSteps.has(stepKey)) {
                    // console.debug(`[SKIP:visitedSteps] trackId=${node.track.id} from=${node.epIdx} to=${nextEpIdx}（端点ペア再通過禁止）`);
                    skipped = `[SKIP:visitedSteps] trackId=${node.track.id} from=${node.epIdx} to=${nextEpIdx}`;
                    continue;
                }
                if (node.visitedTrackInternalMove && node.visitedTrackInternalMove.has(node.track.id)) {
                    // console.debug(`[SKIP:visitedTrackInternalMove] trackId=${node.track.id}（track内移動1回制限）`);
                    skipped = `[SKIP:visitedTrackInternalMove] trackId=${node.track.id}`;
                    continue;
                }
                let addVisitedTrackIdInternalMove = false;
                if (node.track.type === 'double_cross' || node.track.type === 'double_slip_x') {
                    // ダブルクロスの許可ペア以外はスキップ
                    const validPairs = [
                        [0,1],[1,0],[2,3],[3,2],[0,3],[3,0],[1,2],[2,1]
                    ];
                    const isValid = validPairs.some(([a,b]) => a === node.epIdx && b === nextEpIdx);
                    if (!isValid) continue;
                    const stepKey = `${node.track.id}:${node.epIdx}:${nextEpIdx}`;
                    if (node.visitedSteps.has(stepKey)) {
                        // console.debug(`[SKIP:visitedSteps(double_cross)] trackId=${node.track.id} from=${node.epIdx} to=${nextEpIdx}（多端点track端点ペア再通過禁止）`);
                        skipped = `[SKIP:visitedSteps(double_cross)] trackId=${node.track.id} from=${node.epIdx} to=${nextEpIdx}`;
                        continue;
                    }
                    if (node.visitedTrackIdsInternalMove && node.visitedTrackIdsInternalMove.has(node.track.id)) {
                        // console.debug(`[SKIP:visitedTrackIdsInternalMove] trackId=${node.track.id}（多端点trackId再通過禁止）`);
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
                        // console.debug(`[SKIP:visitedTrackIdsInternalMove] trackId=${node.track.id}（2端点trackId再通過禁止）`);
                        skipped = `[SKIP:visitedTrackIdsInternalMove] trackId=${node.track.id}`;
                        continue;
                    }
                }
                let direction = undefined;
                if (node.track.isPoint && typeof node.epIdx === 'number' && typeof nextEpIdx === 'number') {
                    if (node.track.type === 'point_left' || node.track.type === 'point_right') {
                        // 0↔1: normal, 0↔2: reverse 以外はstepを作らない
                        if ((node.epIdx === 0 && nextEpIdx === 1) || (node.epIdx === 1 && nextEpIdx === 0)) direction = 'normal';
                        else if ((node.epIdx === 0 && nextEpIdx === 2) || (node.epIdx === 2 && nextEpIdx === 0)) direction = 'reverse';
                        else continue; // 1↔2, 2↔1等はstepを作らない
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
                // console.debug(`[探索状況] track内移動: trackId=${node.track.id}, fromEpIdx=${node.epIdx} → toEpIdx=${nextEpIdx}`);
                anyTrackMove = true;
            }
            let connectionsArr = Array.isArray(node.track.connections) ? node.track.connections : Array.from(node.track.connections);
            let anyConnectionMove = false;
            for (const [fromIdx, conn] of connectionsArr) {
                if (Number(fromIdx) !== node.epIdx) continue;
                const nextTrack = allTracks.find(t => String(t.id) === String(conn.trackId));
                if (!nextTrack) continue;
                // --- 追加: ダブルクロス/ダブルスリップのtrack間接続も許可ペア以外は除外 ---
                if (nextTrack.type === 'double_cross' || nextTrack.type === 'double_slip_x') {
                    const validPairs = [
                        [0,1],[1,0],[2,3],[3,2],[0,3],[3,0],[1,2],[2,1]
                    ];
                    const isValid = validPairs.some(([a,b]) => a === node.epIdx && b === conn.endpointIndex);
                    if (!isValid) continue;
                }
                // track間移動で入ったtrackIdの再入場禁止
                if (node.visitedTrackIdsByConnection && node.visitedTrackIdsByConnection.has(nextTrack.id)) {
                    // console.debug(`[SKIP:visitedTrackIdsByConnection] nextTrackId=${nextTrack.id}（track間移動再入場禁止）`);
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
                // console.debug(`[探索状況] track間移動: fromTrackId=${node.track.id}, fromEpIdx=${node.epIdx} → toTrackId=${nextTrack.id}, toEpIdx=${conn.endpointIndex}`);
                anyConnectionMove = true;
            }
            // 追加: このnodeからtrack内・track間ともに進めなかった場合、途絶情報を出力
            if (!anyTrackMove && !anyConnectionMove) {
                // console.debug(`[DEADEND] 経路途絶: trackId=${node.track.id}, epIdx=${node.epIdx}, path=`, node.path.map(s => `${s.trackId}(${s.fromEpIdx}->${s.toEpIdx})`).join('→'), skipped ? `最後のスキップ理由: ${skipped}` : '');
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
        // デフォルト名自動連番
        if (!route.name || route.name.startsWith('開通てこ')) {
            // 既存進路名を列挙
            const existingNames = new Set(Array.from(this.routes.values()).map(r => r.name));
            let num = 1;
            let name = '';
            do {
                name = `進路${String(num).padStart(3, '0')}`;
                num++;
            } while (existingNames.has(name));
            route.name = name;
        }
        this.routes.set(route.id, route);
        // console.log('[addRoute後] this.routes:', Array.from(this.routes.values()));
    }

    /**
     * 登録済み進路一覧をUIに表示
     */
    updateRouteList() {
        // console.log('updateRouteList called');
        // console.log('routes:', Array.from(this.routes.values()));
        if (!this.routeList) return;
        this.routeList.innerHTML = '';
        const routes = Array.from(this.routes.values());
        if (routes.length === 0) {
            this.routeList.innerHTML = '<div style="color:gray;">登録された進路はありません</div>';
            return;
        }
        // 編集中のrouteIdをthis.editingRouteIdで管理
        if (this.editingRouteId === undefined) this.editingRouteId = null;
        routes.forEach((route, idx) => {
            const div = document.createElement('div');
            div.className = 'route-item';
            const leverName = route.lever?.name || route.lever?.id || '';
            const destName = route.destination?.name || route.destination?.id || '';
            const headerDiv = document.createElement('div');
            headerDiv.className = 'route-header';
            headerDiv.innerHTML = `<span class="route-name">${route.name || ''}</span> <span class="route-lever">[${leverName}→${destName}]</span>`;
            div.appendChild(headerDiv);
            // ボタン群
            const btnGroup = document.createElement('div');
            btnGroup.style.display = 'flex';
            btnGroup.style.gap = '6px';
            // 開通/解除ボタン
            const actionBtn = document.createElement('button');
            actionBtn.className = 'route-action-btn';
            if (route.isActive) {
                actionBtn.textContent = '解除';
                actionBtn.onclick = () => {
                    if (typeof this.deactivateRoute === 'function') {
                        this.deactivateRoute(route.id);
                        this.updateRouteList();
                    }
                };
            } else {
                actionBtn.textContent = '開通';
                actionBtn.onclick = () => {
                    if (typeof this.activateRoute === 'function') {
                        this.activateRoute(route.id);
                        this.updateRouteList();
                    }
                };
            }
            btnGroup.appendChild(actionBtn);
            // 削除ボタン
            const delBtn = document.createElement('button');
            delBtn.textContent = '削除';
            delBtn.className = 'route-action-btn delete';
            delBtn.onclick = () => {
                this.routes.delete(route.id);
                this.updateRouteList();
            };
            btnGroup.appendChild(delBtn);
            // 詳細ボタン
            const detailBtn = document.createElement('button');
            detailBtn.textContent = '詳細';
            detailBtn.onclick = () => {
                window.routeManager.showRouteDetailModal(route);
            };
            btnGroup.appendChild(detailBtn);
            div.appendChild(btnGroup);
            this.routeList.appendChild(div);
        });
    }

    /**
     * 指定した進路を開通させる
     * @param {string} routeId
     */
    async activateRoute(routeId) {
        const route = this.routes.get(routeId);
        if (!route) return;
        // --- 追加: 進路開通デバッグログ ---
        // console.log('[DEBUG][activateRoute] 開通する進路:', {
        //     routeId: route.id,
        //     name: route.name,
        //     points: (route.points || []).map((step, idx) => ({
        //         idx,
        //         trackId: step.trackId,
        //         fromEpIdx: step.fromEpIdx,
        //         toEpIdx: step.toEpIdx,
        //         type: step.type,
        //         direction: step.direction
        //     }))
        // });
        // --- 支障チェック ---
        // 1. 今開通中の進路一覧
        const activeRoutes = Array.from(this.routes.values()).filter(r => r !== route && r.isActive);
        // 2. 新進路の端点ペア列挙
        const newPairs = (route.points || []).map(s => `${s.trackId}_${s.fromEpIdx}_${s.toEpIdx}`);
        // 3. 支障している進路を列挙
        const conflictRoutes = [];
        for (const ar of activeRoutes) {
            for (const s of ar.points || []) {
                // trackId取得
                const trackId = s.trackId;
                // trackType取得
                let trackType = null;
                if (window.app && window.app.trackManager) {
                    const tracks = window.app.trackManager.tracks;
                    if (typeof tracks.get === 'function') {
                        const t = tracks.get(trackId) || tracks.get(Number(trackId));
                        if (t) trackType = t.type;
                    } else if (typeof tracks === 'object') {
                        const t = tracks[trackId] || tracks[Number(trackId)];
                        if (t) trackType = t.type;
                    }
                }
                // --- 修正: trackTypeによらず端点ペア重複のみ排他 ---
                const pair = `${trackId}_${s.fromEpIdx}_${s.toEpIdx}`;
                if (newPairs.includes(pair)) {
                    conflictRoutes.push(ar);
                    break;
                }
            }
        }
        if (conflictRoutes.length > 0) {
            // ワーニングダイアログ
            const msg = `この進路は既に開通中の進路と重複しています。\n\n支障する進路:\n${conflictRoutes.map(r => r.name).join(', ')}\n\nOKで既存進路を解放して開通、キャンセルで中止します。`;
            const ok = window.confirm(msg);
            if (!ok) return;
            // 支障進路のみ解除
            for (const cr of conflictRoutes) {
                this.deactivateRoute(cr.id);
            }
        }
        // デバッグ: てこtrackId, 経路stepのtrackId一覧
        const leverTrackId = route.lever?.trackId;
        // console.log('[DEBUG] てこtrackId:', leverTrackId);
        const stepTrackIds = (route.points || []).map(s => s.trackId);
        // console.log('[DEBUG] 経路stepのtrackId一覧:', stepTrackIds);
        // 経路上のTrackを進路色・分岐器directionに
        const updatedTrackIds = new Set();
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
            if (!track || updatedTrackIds.has(track.id)) return;
            track.status = 'ROUTE';
            updatedTrackIds.add(track.id);
            // --- ダブルクロス方向判定: cross優先 ---
            if (track.type === 'double_cross' || track.type === 'double_slip_x') {
                // track.clearAllPairStatus && track.clearAllPairStatus(); // ←この行を削除
                // 直進2本（0-1, 2-3）同時開通対応
                let has01 = false, has23 = false;
                for (let i = 0; i < arr.length - 1; i++) {
                    const curr = arr[i];
                    const next = arr[i + 1];
                    if (curr.trackId == track.id && next.trackId == track.id) {
                        // 0-1
                        if ((curr.toEpIdx === 0 && next.toEpIdx === 1) || (curr.toEpIdx === 1 && next.toEpIdx === 0)) has01 = true;
                        // 2-3
                        if ((curr.toEpIdx === 2 && next.toEpIdx === 3) || (curr.toEpIdx === 3 && next.toEpIdx === 2)) has23 = true;
                    }
                }
                // 0-1
                if (has01) {
                    track.setPairStatus(0, 1, 'ROUTE');
                    track.setPairStatus(1, 0, 'ROUTE');
                }
                // 2-3
                if (has23) {
                    track.setPairStatus(2, 3, 'ROUTE');
                    track.setPairStatus(3, 2, 'ROUTE');
                }
                // cross方向は従来通り
                for (let i = 0; i < arr.length - 1; i++) {
                    const curr = arr[i];
                    const next = arr[i + 1];
                    if (curr.trackId == track.id && next.trackId == track.id) {
                        // cross方向のみ
                        if (
                            (curr.toEpIdx === 0 && next.toEpIdx === 3) || (curr.toEpIdx === 3 && next.toEpIdx === 0) ||
                            (curr.toEpIdx === 1 && next.toEpIdx === 2) || (curr.toEpIdx === 2 && next.toEpIdx === 1)
                        ) {
                            track.setPairStatus(curr.toEpIdx, next.toEpIdx, 'ROUTE');
                            track.setPairStatus(next.toEpIdx, curr.toEpIdx, 'ROUTE');
                        }
                    }
                }
                // デバッグ: 全ペアstatus出力
                // console.log('[DEBUG][setPairStatus][allPairs]', {
                //     '0-1': track.getPairStatus(0,1),
                //     '1-0': track.getPairStatus(1,0),
                //     '2-3': track.getPairStatus(2,3),
                //     '3-2': track.getPairStatus(3,2),
                //     '0-3': track.getPairStatus(0,3),
                //     '3-0': track.getPairStatus(3,0),
                //     '2-1': track.getPairStatus(2,1),
                //     '0-2': track.getPairStatus(0,2),
                //     '2-0': track.getPairStatus(2,0),
                //     '1-3': track.getPairStatus(1,3),
                //     '3-1': track.getPairStatus(3,1)
                // });
            } else {
                // --- 追加: status変更直後に個別ログ ---
                // console.log(`[DEBUG][activateRoute] trackId=${track.id} type=${track.type} statusをROUTEに変更`, track);
            }
            // デバッグ: てこtrackIdと一致する場合は明示的に出力
            if (String(step.trackId) === String(leverTrackId)) {
                // console.log(`[DEBUG] てこtrackId(${leverTrackId})と一致: stepIdx=${idx}, track=`, track);
            }
            // 分岐器・ダブルクロス等のdirection自動判定
            if (track.isPoint) {
                if (track.type === 'point_left' || track.type === 'point_right') {
                    // 今回開通する進路（route.points）だけでdirectionを集計
                    let directions = [];
                    for (const s of route.points) {
                        if (s.trackId == track.id && (s.direction === 'normal' || s.direction === 'reverse' || s.direction === 'straight' || s.direction === 'branch')) {
                            directions.push(s.direction);
                        }
                    }
                    // 'branch'優先、なければ'straight'/'normal'
                    let newDirection = 'normal';
                    if (directions.includes('reverse') || directions.includes('branch')) {
                        newDirection = 'reverse';
                    } else if (directions.includes('normal') || directions.includes('straight')) {
                        newDirection = 'normal';
                    }
                    // ここでTrackManager.switchPointを呼ぶ
                    if (window.app && window.app.trackManager) {
                        window.app.trackManager.switchPoint(track.id, newDirection);
                    }
                    track.pointDirection = newDirection; // 状態も同期
                } else {
                    // ダブルクロス等
                    let directions = [];
                    for (const s of route.points) {
                        if (s.trackId == track.id && (s.direction === 'straight' || s.direction === 'cross')) {
                            directions.push(s.direction);
                        }
                    }
                    let newDirection = 'straight';
                    if (directions.includes('cross')) {
                        newDirection = 'cross';
                    } else if (directions.includes('straight')) {
                        newDirection = 'straight';
                    }
                    // ダブルクロス・ダブルスリップも必要ならswitchPoint相当を呼ぶ
                    if (typeof track.setCrossDirection === 'function') {
                        track.setCrossDirection(newDirection);
                    } else {
                        track.pointDirection = newDirection;
                    }
                }
            }
        });
        route.isActive = true;
        if (window.app && window.app.canvas) window.app.canvas.draw();
        // --- ここから追加: 全Trackのstatusを出力 ---
        if (window.app && window.app.trackManager) {
            const tracks = window.app.trackManager.tracks;
            let arr = Array.isArray(tracks) ? tracks : Array.from(tracks.values ? tracks.values() : Object.values(tracks));
            // console.log('[DEBUG][activateRoute] 全Trackのstatus:', arr.map(t => ({id: t.id, status: t.status, type: t.type})));
        }
        // --- ここまで追加 ---
        if (typeof this.updateRouteList === 'function') this.updateRouteList();
    }

    /**
     * 指定した進路を解除する
     * @param {string} routeId
     */
    deactivateRoute(routeId) {
        const route = this.routes.get(routeId);
        if (!route) return;

        // 他のアクティブ進路のstep一覧
        const otherActiveSteps = [];
        for (const r of this.routes.values()) {
            if (r.isActive && r.id !== routeId) {
                otherActiveSteps.push(...(r.points || []));
            }
        }

        // trackIdごとに一度だけ解除判定
        const deactivatedTrackIds = new Set();

        (route.points || []).forEach((step) => {
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
            if (!track) return;
            // --- ここで必ずstatusをnormalに ---
            track.status = 'normal';
            deactivatedTrackIds.add(track.id);
            // --- 追加: ダブルクロス/ダブルスリップの端点ペアstatusもリセット・再集計 ---
            if (track.type === 'double_cross' || track.type === 'double_slip_x') {
                // 全ペアをnormalに
                const validPairs = [
                    [0,1],[1,0],[2,3],[3,2],[0,3],[3,0],[1,2],[2,1]
                ];
                validPairs.forEach(([a,b]) => track.setPairStatus && track.setPairStatus(a, b, 'normal'));
                // 他のアクティブ進路のstepを再集計
                for (const r of this.routes.values()) {
                    if (!r.isActive || r.id === routeId) continue;
                    const arr = r.points || [];
                    // 直進2本（0-1, 2-3）
                    let has01 = false, has23 = false;
                    for (let i = 0; i < arr.length - 1; i++) {
                        const curr = arr[i];
                        const next = arr[i + 1];
                        if (curr.trackId == track.id && next.trackId == track.id) {
                            if ((curr.toEpIdx === 0 && next.toEpIdx === 1) || (curr.toEpIdx === 1 && next.toEpIdx === 0)) has01 = true;
                            if ((curr.toEpIdx === 2 && next.toEpIdx === 3) || (curr.toEpIdx === 3 && next.toEpIdx === 2)) has23 = true;
                        }
                    }
                    if (has01) {
                        track.setPairStatus(0, 1, 'ROUTE');
                        track.setPairStatus(1, 0, 'ROUTE');
                    }
                    if (has23) {
                        track.setPairStatus(2, 3, 'ROUTE');
                        track.setPairStatus(3, 2, 'ROUTE');
                    }
                    // cross方向
                    for (let i = 0; i < arr.length - 1; i++) {
                        const curr = arr[i];
                        const next = arr[i + 1];
                        if (curr.trackId == track.id && next.trackId == track.id) {
                            if (
                                (curr.toEpIdx === 0 && next.toEpIdx === 3) || (curr.toEpIdx === 3 && next.toEpIdx === 0) ||
                                (curr.toEpIdx === 1 && next.toEpIdx === 2) || (curr.toEpIdx === 2 && next.toEpIdx === 1)
                            ) {
                                track.setPairStatus(curr.toEpIdx, next.toEpIdx, 'ROUTE');
                                track.setPairStatus(next.toEpIdx, curr.toEpIdx, 'ROUTE');
                            }
                        }
                    }
                }
                // デバッグ: 全ペアstatus出力
                if (track.getPairStatus) {
                    // console.log('[DEBUG][deactivateRoute][setPairStatus][allPairs]', {
                    //     '0-1': track.getPairStatus(0,1),
                    //     '1-0': track.getPairStatus(1,0),
                    //     '2-3': track.getPairStatus(2,3),
                    //     '3-2': track.getPairStatus(3,2),
                    //     '0-3': track.getPairStatus(0,3),
                    //     '3-0': track.getPairStatus(3,0),
                    //     '2-1': track.getPairStatus(2,1),
                    //     '0-2': track.getPairStatus(0,2),
                    //     '2-0': track.getPairStatus(2,0),
                    //     '1-3': track.getPairStatus(1,3),
                    //     '3-1': track.getPairStatus(3,1)
                    // });
                }
            }
            // 分岐器の場合、他のアクティブ進路のstepを再集計
            if (track.isPoint && (track.type === 'point_left' || track.type === 'point_right')) {
                // 他のアクティブ進路のstepを集計
                let otherDirections = [];
                for (const r of this.routes.values()) {
                    if (!r.isActive || r.id === routeId) continue;
                    for (const s of r.points || []) {
                        if (s.trackId == track.id && (s.direction === 'normal' || s.direction === 'reverse' || s.direction === 'straight' || s.direction === 'branch')) {
                            otherDirections.push(s.direction);
                        }
                    }
                }
                if (otherDirections.includes('reverse') || otherDirections.includes('branch')) {
                    track.pointDirection = 'reverse';
                } else if (otherDirections.includes('normal') || otherDirections.includes('straight')) {
                    track.pointDirection = 'normal';
                } else {
                    // どちらもなければデフォルト
                    track.pointDirection = 'normal';
                }
            }
        });
        route.isActive = false;
        if (window.app && window.app.canvas) window.app.canvas.draw();
        // --- ここから追加: 全Trackのstatusを出力 ---
        if (window.app && window.app.trackManager) {
            const tracks = window.app.trackManager.tracks;
            let arr = Array.isArray(tracks) ? tracks : Array.from(tracks.values ? tracks.values() : Object.values(tracks));
            // console.log('[DEBUG][deactivateRoute] 全Trackのstatus:', arr.map(t => ({id: t.id, status: t.status, type: t.type})));
        }
        // --- ここまで追加 ---
        if (typeof this.updateRouteList === 'function') this.updateRouteList();
    }

    /**
     * すべての進路を削除
     */
    clearRoutes() {
        if (this.routes && typeof this.routes.clear === 'function') {
            this.routes.clear();
        } else if (Array.isArray(this.routes)) {
            this.routes = [];
        }
        this.updateRouteList && this.updateRouteList();
    }

    exitAutoMode() {
        this.currentMode = 'none';
        if (this.autoRouteBtn) this.autoRouteBtn.classList.remove('active');
        if (this.manualRouteBtn) this.manualRouteBtn.classList.remove('active');
        document.body.style.cursor = '';
        this.routeCandidates = [];
        // 必要ならガイダンスや候補リストもリセット
        // 例: if (this.routeList) this.routeList.innerHTML = '';
    }

    // --- 進路詳細モーダル表示機能を追加 ---
    showRouteDetailModal(route) {
        // 既存モーダルがあれば削除
        let modal = document.getElementById('routeDetailModal');
        if (modal) modal.remove();
        modal = document.createElement('div');
        modal.id = 'routeDetailModal';
        modal.className = 'modal show';
        modal.style.zIndex = 2000;
        modal.innerHTML = `
            <div class="modal-content" style="max-width:600px;">
                <div class="modal-header"><h2>進路詳細: ${route.name || ''}</h2><button class="modal-close">×</button></div>
                <div class="modal-body" style="max-height:60vh;overflow-y:auto;"></div>
                <div class="modal-buttons"><button id="routeDetailCloseBtn">閉じる</button></div>
            </div>
        `;
        document.body.appendChild(modal);
        // 閉じるボタン
        modal.querySelector('.modal-close').onclick = () => modal.remove();
        modal.querySelector('#routeDetailCloseBtn').onclick = () => modal.remove();
        // 詳細内容を構築
        const body = modal.querySelector('.modal-body');
        let html = `<div><b>発点てこ:</b> ${route.lever?.name || route.lever?.id || ''}　<b>着点ボタン:</b> ${route.destination?.name || route.destination?.id || ''}</div>`;
        html += `<table style="width:100%;margin-top:10px;border-collapse:collapse;">
            <thead><tr><th>#</th><th>TrackID</th><th>名称</th><th>タイプ</th><th>方向</th><th>DCCアドレス</th></tr></thead><tbody>`;
        (route.points || []).forEach((step, i) => {
            let track = null;
            if (window.app && window.app.trackManager) {
                const tracks = window.app.trackManager.tracks;
                if (typeof tracks.get === 'function') {
                    track = tracks.get(step.trackId) || tracks.get(Number(step.trackId));
                } else if (typeof tracks === 'object') {
                    track = tracks[step.trackId] || tracks[Number(step.trackId)];
                }
            }
            html += `<tr><td>${i+1}</td><td>${step.trackId}</td><td>${track?.name || ''}</td><td>${track?.type || ''}</td><td>${step.direction || ''}</td><td>${track?.dccAddress ?? ''}</td></tr>`;
        });
        html += `</tbody></table>`;
        body.innerHTML = html;
    }
}

window.Route = Route;






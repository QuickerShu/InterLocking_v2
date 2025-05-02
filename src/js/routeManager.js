class Route {
    constructor(name, lever, destinationButton, points, isAuto = true) {
        this.id = crypto.randomUUID();
        this.name = name;
        this.lever = lever;           // テコの情報 {id: string, type: string}
        this.destination = destinationButton; // 着点ボタンの情報 {id: string}
        this.points = points;         // [{id: string, position: 'normal' | 'reverse'}]
        this.isAuto = isAuto;
        this.isActive = false;
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

        // --- 重複排除: Track列＋分岐器direction列＋着点IDでユニーク化 ---
        const uniqueCandidates = [];
        const seenKeys = new Set();
        (allCandidates || []).forEach(cand => {
            if (!cand) return;
            const pathArr = Array.isArray(cand.path) ? cand.path : [];
            // Track通過列
            const trackSeq = pathArr.map(p => p.trackId).join('-');
            // 分岐器direction列（directionがあるstepのみ）
            const dirSeq = pathArr
                .filter(p => p.direction)
                .map(p => `${p.trackId}:${p.direction}`).join('-');
            // 着点IDも重複排除キーに含める
            const destId = cand.destination?.id || cand.destinationButton?.id || '';
            const key = trackSeq + '|' + dirSeq + '|' + destId;
            if (!seenKeys.has(key)) {
                uniqueCandidates.push(cand);
                seenKeys.add(key);
            }
        });
        allCandidates = uniqueCandidates || [];
        // サイドパネルに候補数・内容を表示
        const panel = document.getElementById('selected-properties');
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
                const pathStr = pathArr.map((step, i, arr) => {
                    let track = null;
                    if (window.app && window.app.trackManager) {
                        const tracks = window.app.trackManager.tracks;
                        if (typeof tracks.get === 'function') {
                            track = tracks.get(step.trackId);
                        } else if (typeof tracks === 'object') {
                            track = tracks[step.trackId] || tracks[Number(step.trackId)];
                        }
                    }
                    const name = track ? (track.name || track.id) : step.trackId;
                    // from/to端点
                    let from = (typeof step.fromEpIdx === 'number') ? step.fromEpIdx : (typeof step.from === 'number' ? step.from : null);
                    let to = (typeof step.toEpIdx === 'number') ? step.toEpIdx : (typeof step.to === 'number' ? step.to : null);
                    // 端点情報がなければ、前後stepから推測
                    if (from == null && i > 0) from = arr[i-1].toEpIdx ?? arr[i-1].to ?? arr[i-1].endpoint;
                    if (to == null && typeof step.endpoint === 'number') to = step.endpoint;
                    // 分岐方向
                    let dir = step.direction;
                    if (!dir && track && track.isPoint && typeof step.toEpIdx === 'number' && typeof step.fromEpIdx === 'number') {
                        // 端点ペアから方向を推測（例: 0→1=normal, 0→2=reverse など）
                        if (track.type === 'point_left' || track.type === 'point_right') {
                            if ((step.fromEpIdx === 0 && step.toEpIdx === 1) || (step.fromEpIdx === 1 && step.toEpIdx === 0)) dir = 'normal';
                            else if ((step.fromEpIdx === 0 && step.toEpIdx === 2) || (step.fromEpIdx === 2 && step.toEpIdx === 0)) dir = 'reverse';
                        }
                        if (track.type === 'double_cross' || track.type === 'double_slip_x') {
                            if ((step.fromEpIdx === 0 && step.toEpIdx === 1) || (step.fromEpIdx === 1 && step.toEpIdx === 0) || (step.fromEpIdx === 2 && step.toEpIdx === 3) || (step.fromEpIdx === 3 && step.toEpIdx === 2)) dir = 'straight';
                            else if ((step.fromEpIdx === 0 && step.toEpIdx === 3) || (step.fromEpIdx === 3 && step.toEpIdx === 0) || (step.fromEpIdx === 1 && step.toEpIdx === 2) || (step.fromEpIdx === 2 && step.toEpIdx === 1)) dir = 'cross';
                        }
                    }
                    let dirLabel = '';
                    if (dir) {
                        if (dir === 'normal') dirLabel = '直進';
                        else if (dir === 'reverse') dirLabel = '分岐';
                        else if (dir === 'straight') dirLabel = '直進';
                        else if (dir === 'cross') dirLabel = 'クロス';
                        else dirLabel = dir;
                    }
                    let epStr = '';
                    if (from != null && to != null) {
                        epStr = `[${from}→${to}` + (dirLabel ? `:${dirLabel}` : '') + ']';
                    } else if (to != null) {
                        epStr = `[→${to}` + (dirLabel ? `:${dirLabel}` : '') + ']';
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
    }

    // 進路自動生成（経路候補列挙＋重複排除＋UI表示）
    generateAutoRoute() {
        // ...（既存のgenerateAutoRoute本体をここに必ず含める）...
    }

    /**
     * leverTrack, leverEpIdx, dest, destEpIdx から経路候補を列挙（簡易BFS）
     * @returns {Array} 経路候補配列
     */
    _findAllRoutesFromEndpoint(leverTrack, leverEpIdx, dest, destEpIdx) {
        console.log('[DEBUG:_findAllRoutesFromEndpoint] 入力:', {leverTrack, leverEpIdx, dest, destEpIdx});
        // 全trackリスト取得
        const tracks = window.app.trackManager.tracks;
        const allTracks = Array.isArray(tracks)
            ? tracks
            : Array.from(tracks.values ? tracks.values() : Object.values(tracks));
        // connections構造をデバッグ出力
        allTracks.forEach(t => {
            console.log(`[DEBUG:connections] trackId=${t.id}`, t.connections);
        });
        // BFS探索
        const queue = [];
        const results = [];
        queue.push({
            track: leverTrack,
            epIdx: leverEpIdx,
            path: [{trackId: leverTrack.id, fromEpIdx: null, toEpIdx: leverEpIdx}],
            visitedTrackIds: new Set([String(leverTrack.id)]),
            visitedPairs: new Set([`${leverTrack.id}:${leverEpIdx}`])
        });
        console.log('[DEBUG:BFS初期キュー]', JSON.stringify(queue, null, 2));
        let bfsStep = 0;
        while (queue.length > 0) {
            const node = queue.shift();
            bfsStep++;
            console.log(`[DEBUG:BFS] step=${bfsStep} 現在: trackId=${node.track.id}, epIdx=${node.epIdx}, path=`, node.path);
            // ゴール判定
            if (String(node.track.id) === String(dest.trackId) && node.epIdx === destEpIdx) {
                console.log(`[DEBUG:BFS] 到達: trackId=${node.track.id}, epIdx=${node.epIdx}`);
                results.push({path: node.path});
                continue;
            }
            // track内端点間移動（無限ループ防止: 1往復のみ許可）
            const endpoints = Array.isArray(node.track.endpoints) ? node.track.endpoints : [];
            for (let nextEpIdx = 0; nextEpIdx < endpoints.length; nextEpIdx++) {
                if (nextEpIdx === node.epIdx) continue;
                const pairKey = `${node.track.id}:${node.epIdx}->${nextEpIdx}`;
                if (node.visitedPairs.has(pairKey)) continue;
                // 逆方向の移動もvisitedPairsに含めて無限ループ防止
                const reversePairKey = `${node.track.id}:${nextEpIdx}->${node.epIdx}`;
                if (node.visitedPairs.has(reversePairKey)) continue;
                const newVisitedPairs = new Set(node.visitedPairs);
                newVisitedPairs.add(pairKey);
                newVisitedPairs.add(reversePairKey);
                console.log(`[DEBUG:BFS] track内移動: ${node.track.id} ${node.epIdx}->${nextEpIdx}`);
                queue.push({
                    track: node.track,
                    epIdx: nextEpIdx,
                    path: node.path.concat({trackId: node.track.id, fromEpIdx: node.epIdx, toEpIdx: nextEpIdx}),
                    visitedTrackIds: new Set(node.visitedTrackIds),
                    visitedPairs: newVisitedPairs
                });
            }
            // track間移動（今いる端点から出ているconnectionsだけを使う）
            let connectionsArr = Array.isArray(node.track.connections) ? node.track.connections : Array.from(node.track.connections);
            for (const [fromIdx, conn] of connectionsArr) {
                if (Number(fromIdx) !== node.epIdx) continue; // 今いる端点からのみ
                const nextTrack = allTracks.find(t => String(t.id) === String(conn.trackId));
                if (!nextTrack) continue;
                if (node.visitedTrackIds.has(String(nextTrack.id))) {
                    console.log(`[DEBUG:BFS] track間移動: ${node.track.id} epIdx=${node.epIdx} → ${nextTrack.id} (再通過禁止)`);
                    continue;
                }
                const newVisitedTrackIds = new Set(node.visitedTrackIds);
                newVisitedTrackIds.add(String(nextTrack.id));
                console.log(`[DEBUG:BFS] track間移動: ${node.track.id} epIdx=${node.epIdx} → ${nextTrack.id} epIdx=${conn.endpointIndex}`);
                queue.push({
                    track: nextTrack,
                    epIdx: conn.endpointIndex,
                    path: node.path.concat({trackId: nextTrack.id, fromEpIdx: node.epIdx, toEpIdx: conn.endpointIndex}),
                    visitedTrackIds: newVisitedTrackIds,
                    visitedPairs: new Set() // trackをまたぐのでリセット
                });
            }
        }
        console.log('[DEBUG:_findAllRoutesFromEndpoint] 経路候補:', results);
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
        // まず全進路を解除（単純化のため）
        this.routes.forEach(r => { if (r.isActive) this.deactivateRoute(r.id); });
        // 経路上のTrackを進路色・分岐器directionに
        (route.points || []).forEach((step, idx, arr) => {
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
            // 線路色: 進路中
            track.status = 'ROUTE';
            // 分岐器・ダブルクロス等のdirection自動判定
            if (track.isPoint) {
                // from/to端点ペアからdirectionを判定
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
            // ダブルクロス等のrouteSegmentsもセット（描画用）
            if (track.type === 'double_cross' || track.type === 'double_slip_x') {
                if (!track.routeSegments) track.routeSegments = { in: [] };
                track.routeSegments.in.push({ from: step.fromEpIdx, to: step.toEpIdx });
            }
        });
        route.isActive = true;
        // 再描画
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
            track.status = 'normal';
            // 分岐器等のdirectionも元に戻す（ここでは初期値に）
            if (track.isPoint) {
                if (track.type === 'point_left' || track.type === 'point_right') track.pointDirection = 'normal';
                else if (track.type === 'double_cross' || track.type === 'double_slip_x') track.pointDirection = 'straight';
            }
            // ダブルクロス等のrouteSegmentsもクリア
            if (track.routeSegments) track.routeSegments.in = [];
        });
        route.isActive = false;
        if (window.app && window.app.canvas) window.app.canvas.draw();
    }
}



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
        this.showGuidance('auto');
        this.updateModeIndicator('auto');

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
        console.log('track 1:', trackElementsForGraph.find(t => t.id == '1'));
        this.buildTrackGraph(trackElementsForGraph);
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
            trackId: l.trackId !== undefined && l.trackId !== null ? String(l.trackId) : '', // 厳密に文字列化
            x: l.x,
            y: l.y
        }));
        const destButtons = (this.interlockingManager.destinationButtons || []).map(b => ({
            id: b.id,
            trackId: b.trackId !== undefined && b.trackId !== null ? String(b.trackId) : '', // 厳密に文字列化
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
                        );
                        if (candidates && candidates.length > 0) {
                            candidates.forEach(c => {
                                const route = new Route(
                                    `${this.getLeverTypeName(lever.type)} ${this.routes.size + 1}`,
                                    lever,
                                    dest,
                                    c.path,
                                    true
                                );
                                allCandidates.push(route);
                            });
                        }
                    });
                });
            });
        });
        console.log('allCandidates.length:', allCandidates.length);
        this.showRouteCandidatesInPanel(allCandidates);
    }

    exitAutoMode() {
        this.currentMode = 'none';
        this.autoRouteBtn.classList.remove('active');
        this.selectedLever = null;
        this.selectedDestination = null;
        document.body.style.cursor = 'default';
        this.hideGuidance();
        this.updateModeIndicator('none');
        
        // 選択状態のクリア
        document.querySelectorAll('.selected-lever, .selected-point').forEach(el => {
            el.classList.remove('selected-lever', 'selected-point');
        });
    }

    enterManualMode() {
        this.currentMode = 'manual';
        this.manualRouteBtn.classList.add('active');
        this.autoRouteBtn.classList.remove('active');
        this.tempRoute = {
            points: []
        };
        document.body.style.cursor = 'crosshair';
        this.showGuidance('manual');
        this.updateModeIndicator('manual');
    }

    exitManualMode() {
        if (this.tempRoute && this.tempRoute.points.length >= 2) {
            this.finalizeManualRoute();
        }
        this.currentMode = 'none';
        this.manualRouteBtn.classList.remove('active');
        this.tempRoute = null;
        document.body.style.cursor = 'default';
        this.hideGuidance();
        this.updateModeIndicator('none');
        
        // 選択状態のクリア
        document.querySelectorAll('.selected-point').forEach(el => {
            el.classList.remove('selected-point');
        });
    }

    cancelRouteGeneration() {
        if (this.currentMode === 'auto') {
            this.exitAutoMode();
        } else if (this.currentMode === 'manual') {
            this.currentMode = 'none';
            this.manualRouteBtn.classList.remove('active');
            this.tempRoute = null;
            document.body.style.cursor = 'default';
            this.hideGuidance();
            this.updateModeIndicator('none');
            
            // 選択状態のクリア
            document.querySelectorAll('.selected-point').forEach(el => {
                el.classList.remove('selected-point');
            });
        }
    }

    handleElementClick(elementId, elementType) {
        if (this.currentMode === 'auto') {
            this.handleAutoModeClick(elementId, elementType);
        } else if (this.currentMode === 'manual') {
            this.handleManualModeClick(elementId, elementType);
        }
    }

    handleAutoModeClick(elementId, elementType) {
        if (this.isLeverType(elementType) && !this.selectedLever) {
            // テコが選択された場合
            this.selectedLever = {
                id: elementId,
                type: elementType
            };
            document.querySelector(`[data-element-id="${elementId}"]`).classList.add('selected-lever');
        } else if (elementType === 'destButton' && this.selectedLever) {
            // 着点ボタンが選択された場合
            this.selectedDestination = {
                id: elementId
            };
            this.generateAutoRoute();
        }
    }

    handleManualModeClick(elementId, elementType) {
        if (!this.tempRoute) {
            // 新しい手動進路の開始
            if (this.isLeverType(elementType)) {
                this.tempRoute = {
                    lever: {
                        id: elementId,
                        type: elementType
                    },
                    points: []
                };
                document.querySelector(`[data-element-id="${elementId}"]`).classList.add('selected-lever');
            }
        } else if (!this.tempRoute.destination) {
            if (elementType === 'point') {
                // ポイントの追加
                const position = document.querySelector(`[data-element-id="${elementId}"]`).dataset.position || 'normal';
                this.tempRoute.points.push({
                    id: elementId,
                    position: position
                });
                document.querySelector(`[data-element-id="${elementId}"]`).classList.add('selected-point');
            } else if (elementType === 'destButton') {
                // 着点ボタンの選択で進路確定
                this.tempRoute.destination = {
                    id: elementId
                };
                this.finalizeManualRoute();
            }
        }
    }

    isLeverType(type) {
        return ['signalLever', 'shuntingLever', 'markerLever', 'throughLever'].includes(type);
    }

    getLeverTypeName(type) {
        const types = {
            'signalLever': '信号てこ',
            'shuntingLever': '入換てこ',
            'markerLever': '標識てこ',
            'throughLever': '開通てこ'
        };
        return types[type] || type;
    }

    // グラフの構築
    buildTrackGraph(trackElements) {
        this.trackGraph = new Map(); // Map<nodeId, TrackNode>

        // 1. 各trackの各端点をノードとして追加
        trackElements.forEach(track => {
            if (Array.isArray(track.endpoints)) {
                track.endpoints.forEach((ep, idx) => {
                    const nodeId = `${track.id}:${idx}`;
                    if (!this.trackGraph.has(nodeId)) {
                        this.trackGraph.set(nodeId, new TrackNode(nodeId));
                    }
                });
            }
        });

        // 2. 各trackのconnectionsからエッジを追加
        trackElements.forEach(track => {
            if (Array.isArray(track.connections)) {
                track.connections.forEach(([fromIdx, conn]) => {
                    const fromNodeId = `${track.id}:${fromIdx}`;
                    const toNodeId = `${conn.trackId}:${conn.endpointIndex}`;
                    const fromNode = this.trackGraph.get(fromNodeId);
                    const toNode = this.trackGraph.get(toNodeId);
                    if (fromNode && toNode) {
                        fromNode.addConnection(toNode, 1, 'normal');
                        toNode.addConnection(fromNode, 1, 'normal'); // 双方向
                        if (track.id === '2') {
                            console.log('[DEBUG:buildTrackGraph] エッジ追加:', fromNodeId, '<->', toNodeId, 'conn:', conn);
                        }
                    }
                });
            }
        });

        // 3. 各track内の全端点ペアをエッジで結ぶ（線路上の移動）
        trackElements.forEach(track => {
            if (Array.isArray(track.endpoints) && track.endpoints.length >= 2) {
                for (let i = 0; i < track.endpoints.length; i++) {
                    for (let j = i + 1; j < track.endpoints.length; j++) {
                        const nodeA = this.trackGraph.get(`${track.id}:${i}`);
                        const nodeB = this.trackGraph.get(`${track.id}:${j}`);
                        if (nodeA && nodeB) {
                            let posA = 'track', posB = 'track';
                            if (track.isPoint) {
                                // point_left/point_right: 0-1=normal, 0-2=reverse
                                if (track.type === 'point_left' || track.type === 'point_right') {
                                    // 0-1（直進）
                                    if ((i === 0 && j === 1) || (i === 1 && j === 0)) {
                                        posA = posB = 'normal';
                                        nodeA.addConnection(nodeB, 1, posA);
                                        nodeB.addConnection(nodeA, 1, posB);
                                        continue;
                                    }
                                    // 0-2（分岐）
                                    if ((i === 0 && j === 2) || (i === 2 && j === 0)) {
                                        posA = posB = 'reverse';
                                        nodeA.addConnection(nodeB, 1, posA);
                                        nodeB.addConnection(nodeA, 1, posB);
                                        continue;
                                    }
                                    // 1-2間はエッジを張らない
                                    continue;
                                }
                                // double_cross: 直進0-1,2-3 分岐0-3,1-2 のみ
                                if (track.type === 'double_cross') {
                                    // 直進
                                    if ((i === 0 && j === 1) || (i === 1 && j === 0)) {
                                        posA = posB = 'normal';
                                        nodeA.addConnection(nodeB, 1, posA);
                                        nodeB.addConnection(nodeA, 1, posB);
                                        continue;
                                    }
                                    if ((i === 2 && j === 3) || (i === 3 && j === 2)) {
                                        posA = posB = 'normal';
                                        nodeA.addConnection(nodeB, 1, posA);
                                        nodeB.addConnection(nodeA, 1, posB);
                                        continue;
                                    }
                                    // 分岐
                                    if ((i === 0 && j === 3) || (i === 3 && j === 0)) {
                                        posA = posB = 'reverse';
                                        nodeA.addConnection(nodeB, 1, posA);
                                        nodeB.addConnection(nodeA, 1, posB);
                                        continue;
                                    }
                                    if ((i === 1 && j === 2) || (i === 2 && j === 1)) {
                                        posA = posB = 'reverse';
                                        nodeA.addConnection(nodeB, 1, posA);
                                        nodeB.addConnection(nodeA, 1, posB);
                                        continue;
                                    }
                                    // その他の端点ペアはエッジを張らない
                                    continue;
                                }
                            }
                            nodeA.addConnection(nodeB, 1, posA);
                            nodeB.addConnection(nodeA, 1, posB);
                        }
                    }
                }
            }
        });
    }

    // 経路の競合をチェック
    checkRouteConflict(route1, route2) {
        // 進路を構成する全ての線路IDを抽出
        const getTrackIds = (route) => {
            if (!route.points) return [];
            return route.points.map(p => p.trackId || p.id).filter(id => id !== undefined && id !== null);
        };
        const route1Tracks = new Set(getTrackIds(route1));
        const route2Tracks = new Set(getTrackIds(route2));

        // 1本でも重複していれば競合
        for (const trackId of route1Tracks) {
            if (route2Tracks.has(trackId)) {
                    return true;
            }
        }
        return false;
    }

    // 経路の実現可能性をチェック
    validateRoute(route) {
        // 始点・終点track通過必須
        if (
            !route.points.length ||
            route.points[0].trackId !== route.lever.trackId ||
            route.points[route.points.length - 1].trackId !== route.destination.trackId
        ) {
            return false;
        }
        return true;
    }

    async generateAutoRoute() {
        try {
            // デバッグ: levers/destButtonsのendpointIndexを出力
            console.log('levers:', this.interlockingManager.startLevers.map(l => ({id: l.id, trackId: l.trackId, endpointIndex: l.endpointIndex})));
            console.log('destButtons:', this.interlockingManager.destinationButtons.map(b => ({id: b.id, trackId: b.trackId, endpointIndex: b.endpointIndex})));
            // すべてのてこ・着点ボタンの組み合わせで候補生成
            const levers = (this.interlockingManager.startLevers || []).map(l => ({
                id: l.id,
                type: l.type,
                trackId: l.trackId !== undefined && l.trackId !== null ? String(l.trackId) : '',
                x: l.x,
                y: l.y
            }));
            const destButtons = (this.interlockingManager.destinationButtons || []).map(b => ({
                id: b.id,
                trackId: b.trackId !== undefined && b.trackId !== null ? String(b.trackId) : '',
                x: b.x,
                y: b.y
            }));
            const tracks = window.app.trackManager.tracks;
            const trackElements = Array.isArray(tracks)
                ? tracks
                : Array.from(tracks.values ? tracks.values() : Object.values(tracks));
            const trackElementsForGraph = trackElements.map(track => {
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
                    connections: connectionsArr,
                    normalConnection,
                    reverseConnection
                };
            });
            // デバッグ: trackのconnections/endpoints
            console.log('[DEBUG:track] 全trackのconnections/endpoints:');
            trackElementsForGraph.forEach(t => {
                console.log(`track ${t.id}: endpoints=`, t.endpoints, 'connections=', t.connections);
                if (t.id === '2') {
                    console.log('[DEBUG:track2] endpoints=', t.endpoints, 'connections=', t.connections);
                }
            });
            this.buildTrackGraph(trackElementsForGraph);
            // 端点indexを求める関数
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
            let allCandidates = [];
            levers.forEach(lever => {
                const leverTrack = trackElementsForGraph.find(t => t.id == lever.trackId);
                if (!leverTrack) return;
                for (const dest of destButtons) {
                    const destTrack = trackElementsForGraph.find(t => t.id == dest.trackId);
                    if (!destTrack) continue;
                    function getConnectedEndpointIndices(track) {
                        let conns = track.connections;
                        if (!Array.isArray(conns)) {
                            if (conns && typeof conns.forEach === 'function') {
                                conns = Array.from(conns);
                            } else {
                                return [];
                            }
                        }
                        return [...new Set(conns.map(([idx, _]) => idx))];
                    }
                    // lever
                    const leverConnected = getConnectedEndpointIndices(leverTrack);
                    let leverEpIdxs;
                    if (leverConnected.length > 0) {
                        leverEpIdxs = leverConnected;
                    } else {
                        leverEpIdxs = [getNearestEndpointIndex(leverTrack, lever.x, lever.y)];
                    }
                    // dest
                    const destConnected = getConnectedEndpointIndices(destTrack);
                    let destEpIdxs;
                    if (destConnected.length > 0) {
                        destEpIdxs = destConnected;
                    } else {
                        destEpIdxs = [getNearestEndpointIndex(destTrack, dest.x, dest.y)];
                    }
                    leverEpIdxs.forEach(leverEpIdx => {
                        destEpIdxs.forEach(destEpIdx => {
                            const candidates = this._findAllRoutesFromEndpoint(leverTrack, leverEpIdx, dest, destEpIdx);
                            candidates.forEach(c => {
                                const route = new Route(
                                    `${this.getLeverTypeName(lever.type)} ${this.routes.size + 1}`,
                                    lever,
                                    dest,
                                    c.path,
                                    true
                                );
                                if (this.validateRoute(route)) {
                                    if (!allCandidates.some(r => JSON.stringify(r.points) === JSON.stringify(route.points))) {
                                        allCandidates.push(route);
                                    }
                                }
                            });
                        });
                    });
                }
            });
            this.showRouteCandidatesInPanel(allCandidates);
        } catch (error) {
            console.error('進路生成エラー:', error);
            alert(`進路生成エラー: ${error.message}`);
        }
    }

    // プロパティパネルに進路候補を表示し、一括登録ボタンを設置
    showRouteCandidatesInPanel(candidates) {
        const panel = document.getElementById('selected-properties');
        if (!panel) return;
        this._routeCandidatesPanelList = candidates.slice();
        const render = () => {
            panel.innerHTML = '';
            const candidates = this._routeCandidatesPanelList;
            if (!candidates || candidates.length === 0) {
                panel.innerHTML = '<p>進路候補がありません</p>';
                if (typeof this.hideGuidance === 'function') this.hideGuidance();
                const autoRouteBtn = document.getElementById('autoRouteBtn');
                if (autoRouteBtn) autoRouteBtn.classList.remove('active');
                return;
            }
            // 進路登録ボタン
            const registerBtn = document.createElement('button');
            registerBtn.textContent = '表示中の候補をすべて進路登録';
            registerBtn.className = 'route-register-btn';
            registerBtn.onclick = () => {
                if (this._routeCandidatesPanelList && this._routeCandidatesPanelList.length > 0) {
                    this._routeCandidatesPanelList.forEach(route => {
                        this.addRoute(route);
                    });
                    this.updateRouteList && this.updateRouteList();
                }
                this._routeCandidatesPanelList = [];
                panel.innerHTML = '<p>進路候補を登録しました。</p>';
                // --- 追加: 自動生成モードのガイダンス・ボタン状態を解除 ---
                if (typeof this.hideGuidance === 'function') this.hideGuidance();
                const autoRouteBtn = document.getElementById('autoRouteBtn');
                if (autoRouteBtn) autoRouteBtn.classList.remove('active');
            };
            panel.appendChild(registerBtn);
            candidates.forEach((route, idx) => {
                const routeDiv = document.createElement('div');
                routeDiv.className = 'route-item candidate';
                const lever = route.startLever || route.lever;
                const dest = route.destButton || route.destination;
                const leverName = lever?.name || lever?.id || '';
                const destName = dest?.name || dest?.id || '';
                let html = `<div><b>てこ:</b> ${leverName}　<b>着点:</b> ${destName}</div>`;
                // --- 分岐器direction: trackごとに最後の通過stepを記録 ---
                const path = route.path || route.points || [];
                const lastPointStep = {};
                path.forEach((step, i) => {
                    if (step.direction && step.trackId) {
                        lastPointStep[step.trackId] = step;
                    }
                });
                const pointDirections = [];
                for (const trackId in lastPointStep) {
                    const step = lastPointStep[trackId];
                    let outEp = '';
                    if (typeof step.toEpIdx === 'number') outEp = `→端点${step.toEpIdx}`;
                    pointDirections.push(`<span style='color:#1976D2;'>${trackId}${outEp}（${step.direction}）</span>`);
                }
                let partNames = path.map(step => {
                    let track = null;
                    if (window.app && window.app.trackManager) {
                        const tracks = window.app.trackManager.tracks;
                        if (typeof tracks.get === 'function') {
                            track = tracks.get(step.trackId);
                        } else if (typeof tracks === 'object') {
                            track = tracks[step.trackId] || tracks[Number(step.trackId)];
                        }
                    }
                    return track ? track.name : step.trackId;
                });
                html += `<div style='margin:4px 0;'><b>経路:</b> ${partNames.join(' → ')}</div>`;
                if (pointDirections.length > 0) {
                    html += `<div style='margin:2px 0 4px 0;'><b>分岐器開通方向:</b> ${pointDirections.join(', ')}</div>`;
                }
                // 削除ボタン
                const delBtn = document.createElement('button');
                delBtn.textContent = '削除';
                delBtn.className = 'route-delete-btn';
                delBtn.onclick = (e) => {
                    this._routeCandidatesPanelList.splice(idx, 1);
                    render();
                    e.stopPropagation();
                };
                routeDiv.innerHTML = html;
                routeDiv.appendChild(delBtn);
                panel.appendChild(routeDiv);
            });
        };
        render();
    }

    finalizeManualRoute() {
        if (this.tempRoute && this.tempRoute.lever && this.tempRoute.destination) {
            const routeName = `${this.getLeverTypeName(this.tempRoute.lever.type)} ${this.routes.size + 1}`;
            const route = new Route(
                routeName,
                this.tempRoute.lever,
                this.tempRoute.destination,
                this.tempRoute.points,
                false
            );
            
            if (this.validateRoute(route)) {
                this.addRoute(route);
                this.updateRouteList();
                this.highlightRoute(route.points);
            } else {
                alert('この進路は既存の進路と競合するため設定できません');
            }
        }
        
        this.exitManualMode();
    }

    addRoute(route) {
        this.routes.set(route.id, route);
    }

    removeRoute(routeId) {
        const route = this.routes.get(routeId);
        if (route) {
            if (route.isActive) {
                route.deactivate();
                this.resetAllTracksStatus(); // 進路削除時に全線路をnormalに
            }
            this.routes.delete(routeId);
            this.updateRouteList();
        }
    }

    clearRoutes() {
        this.routes.forEach(route => {
            if (route.isActive) {
                route.deactivate();
            }
        });
        this.resetAllTracksStatus(); // 全進路解除時にも全線路をnormalに
        this.routes.clear();
        this.updateRouteList();
    }

    updateRouteList() {
        this.routeList.innerHTML = '';
        
        this.routes.forEach(route => {
            const routeElement = document.createElement('div');
            routeElement.className = 'route-item';
            
            let pointDetails = '';
            if (route.points && route.points.length > 0) {
                pointDetails = route.points.map(point => {
                    let track = null;
                    if (window.app && window.app.trackManager) {
                        track = window.app.trackManager.getTrack(point.id || point.trackId);
                    }
                    let pointStr = track ? track.name || `線路${point.id || point.trackId}` : `線路${point.id || point.trackId}`;
                    if (point.position) {
                        pointStr += point.position === 'normal' ? ' [直進]' : ' [分岐]';
                    }
                    return pointStr;
                }).join(' → ');
            }

            routeElement.innerHTML = `
                <div class="route-header">
                    <span class="route-name">${route.name}</span>
                    <span class="route-generation-mode ${route.isAuto ? 'auto' : 'manual'}">
                        ${route.isAuto ? '自動生成' : '手動生成'}
                    </span>
                    <div class="route-actions">
                        <button class="route-action-btn" onclick="routeManager.activateRoute('${route.id}')">
                            ${route.isActive ? '解除' : '設定'}
                        </button>
                        <button class="route-action-btn delete" onclick="routeManager.removeRoute('${route.id}')">
                            削除
                        </button>
                    </div>
                </div>
                <div class="route-details">
                    <div>テコ: ${this.getLeverTypeName(route.lever.type)} ${route.lever.name || route.lever.id}</div>
                    <div>着点: ${route.destination.name || `着点ボタン ${route.destination.id}`}</div>
                    <div class="route-points">${pointDetails || '<span style="color:#888">分岐器はありません</span>'}</div>
                </div>
            `;
            this.routeList.appendChild(routeElement);
        });
    }

    async activateRoute(routeId) {
        const route = this.routes.get(routeId);
        if (!route) return;

            if (route.isActive) {
                route.deactivate();
                this.activeRoutes.delete(route);
            this.resetAllTracksStatus(); // 進路解除ボタンで全線路をnormalに
            this.updateRouteList();
            return;
        }

                // 競合チェック
        const conflicts = [];
                this.activeRoutes.forEach(activeRoute => {
                    if (this.checkRouteConflict(route, activeRoute)) {
                conflicts.push(activeRoute);
            }
        });

        if (conflicts.length > 0) {
            const ok = await this.showConflictModal(conflicts);
            if (!ok) return;
            // 競合進路を開放
            conflicts.forEach(r => {
                r.deactivate();
                this.activeRoutes.delete(r);
            });
            this.resetAllTracksStatus(); // 競合解除時にも全線路をnormalに
        }

        // --- 分岐器ごとに「最後に出るstepのdirection」だけを採用するロジック ---
        // 1. 経路上の分岐器の出口stepを記録
        const lastDirectionByPoint = {};
        if (route.points && Array.isArray(route.points)) {
            for (let idx = 0; idx < route.points.length; idx++) {
                const step = route.points[idx];
                if (!step.trackId && !step.id) continue;
                const trackId = step.trackId || step.id;
                let track = null;
                if (window.app && window.app.trackManager && window.app.trackManager.tracks) {
                    const tracks = window.app.trackManager.tracks;
                    if (typeof tracks.get === 'function') {
                        track = tracks.get(trackId) || tracks.get(String(trackId)) || tracks.get(Number(trackId));
                    } else if (typeof tracks === 'object') {
                        track = tracks[trackId] || tracks[String(trackId)] || tracks[Number(trackId)];
                    }
                }
                if (track && track.isPoint && step.direction) {
                    // 分岐器の出口stepのdirectionを記録（上書きでOK: 最後の出口stepが残る）
                    lastDirectionByPoint[trackId] = step.direction;
                }
            }
        }

        // 2. 経路上の全線路のstatus/directionを設定
        if (window.app && window.app.trackManager) {
            const tracks = window.app.trackManager.tracks;
            // まず全trackのrouteSegmentsをリセット
            for (const t of (typeof tracks.values === 'function' ? tracks.values() : Object.values(tracks))) {
                t.routeSegments = undefined;
            }
            // 経路内線分を記録
            const routeSegmentsByTrack = {};
            if (route.points && Array.isArray(route.points)) {
                // ダブルクロスやポイントの線分を特定
                for (let idx = 0; idx < route.points.length - 1; idx++) {
                    const step = route.points[idx];
                    const nextStep = route.points[idx + 1];
                    const trackId = step.trackId || step.id;
                    const nextTrackId = nextStep.trackId || nextStep.id;
                    if (trackId === nextTrackId) {
                        // 同じtrack内の移動（ダブルクロスやポイントの通過）
                        if (!routeSegmentsByTrack[trackId]) routeSegmentsByTrack[trackId] = {in: [], out: []};
                        routeSegmentsByTrack[trackId].in.push({from: step.endpoint, to: nextStep.endpoint, direction: step.direction || nextStep.direction});
                    }
                }
            }
            // 全trackにrouteSegmentsをセット
            for (const t of (typeof tracks.values === 'function' ? tracks.values() : Object.values(tracks))) {
                if (routeSegmentsByTrack[t.id]) {
                    t.routeSegments = routeSegmentsByTrack[t.id];
                } else {
                    t.routeSegments = {in: [], out: []};
                }
            }
            // status/directionの設定
            if (route.points && Array.isArray(route.points)) {
                // --- 追加: 多端点trackの通過ペアに応じた物理方向自動設定 ---
                // 1. 経路上のtrack内移動stepを抽出
                const multiTrackPairs = [];
                for (let i = 0; i < route.points.length - 1; i++) {
                    const [curTrackId, curEpIdx] = route.points[i].trackId ? [route.points[i].trackId, route.points[i].endpoint] : [route.points[i].id, route.points[i].endpoint];
                    const [nextTrackId, nextEpIdx] = route.points[i + 1].trackId ? [route.points[i + 1].trackId, route.points[i + 1].endpoint] : [route.points[i + 1].id, route.points[i + 1].endpoint];
                    // trackIdが同じで端点が異なる場合（track内移動）はスキップ
                    if (curTrackId === nextTrackId) continue;
                    // curTrackIdのto=curEpIdx, nextTrackIdのfrom=nextEpIdx
                    // ここで「多端点track」の場合のみペアを記録
                    const curTrack = this.interlockingManager.trackManager.getTrack(curTrackId);
                    if (curTrack && (curTrack.type === 'double_cross' || curTrack.type === 'double_slip_x')) {
                        // from: 直前の端点, to: 今回の端点
                        multiTrackPairs.push({
                            track: curTrack,
                            from: curEpIdx,
                            to: nextEpIdx
                        });
                    }
                }
                console.log('[DEBUG:activateRoute] multiTrackPairs:', multiTrackPairs);
                for (const pair of multiTrackPairs) {
                    const {track, from, to} = pair;
                    if (track.type === 'double_cross') {
                        let dir = null;
                        if ((from === 0 && to === 1) || (from === 1 && to === 0) || (from === 2 && to === 3) || (from === 3 && to === 2)) {
                            dir = 'straight';
                        } else if ((from === 0 && to === 3) || (from === 3 && to === 0) || (from === 1 && to === 2) || (from === 2 && to === 1)) {
                            dir = 'cross';
                        }
                        console.log(`[DEBUG:activateRoute] setCrossDirection: trackId=${track.id}, type=${track.type}, from=${from}, to=${to}, dir=${dir}`);
                        if (dir && track.setCrossDirection) {
                            await track.setCrossDirection(dir);
                        }
                    } else if (track.isPoint) {
                        const dir = lastDirectionByPoint[track.id] || 'normal';
                        if (track.setPointDirection) {
                            await track.setPointDirection(dir);
                        }
                    }
                }
                // --- 既存の分岐器direction設定も維持 ---
                for (let idx = 0; idx < route.points.length; idx++) {
                    const step = route.points[idx];
                    let track = null;
                    const trackId = step.trackId || step.id;
                    if (typeof tracks.get === 'function') {
                        track = tracks.get(trackId) || tracks.get(String(trackId)) || tracks.get(Number(trackId));
                    } else if (typeof tracks === 'object') {
                        track = tracks[trackId] || tracks[String(trackId)] || tracks[Number(trackId)];
                    }
                    if (track) {
                        track.setStatus && track.setStatus('ROUTE');
                        if (track.isPoint) {
                            if (track.type === 'double_cross') {
                                // すでにsetCrossDirectionで設定済みなので何もしない
                                console.log(`[DEBUG:activateRoute] skip setPointDirection for double_cross: trackId=${track.id}`);
                            } else {
                                const dir = lastDirectionByPoint[trackId] || 'normal';
                                console.log(`[DEBUG:activateRoute] setPointDirection: trackId=${track.id}, type=${track.type}, dir=${dir}`);
                                if (track.setPointDirection) {
                                    await track.setPointDirection(dir);
                                }
                            }
                        }
                    }
                }
            }
            if (window.app && window.app.canvas) window.app.canvas.draw();
        }

        route.activate();
        this.activeRoutes.add(route);
            this.updateRouteList();
        }

    showConflictModal(conflicts) {
        return new Promise(resolve => {
            const modal = document.getElementById('conflictModal');
            const okBtn = document.getElementById('conflictOkBtn');
            const cancelBtn = document.getElementById('conflictCancelBtn');
            const body = document.getElementById('conflictModalBody');
            if (body) {
                body.innerHTML = `競合する進路が既に開通しています。<br>OKを押すと既存進路（${conflicts.map(r => r.name).join('、')}）を解除して新しい進路を開通します。<br>キャンセルで中止します。`;
            }
            modal.classList.add('show');
            const cleanup = () => {
                modal.classList.remove('show');
                okBtn.onclick = null;
                cancelBtn.onclick = null;
            };
            okBtn.onclick = () => { cleanup(); resolve(true); };
            cancelBtn.onclick = () => { cleanup(); resolve(false); };
        });
    }

    async saveRoutes() {
        const routesData = Array.from(this.routes.values()).map(route => route.toJSON());
        try {
            localStorage.setItem('savedRoutes', JSON.stringify(routesData));
            // 成功メッセージを表示
        } catch (error) {
            console.error('進路の保存に失敗しました:', error);
            // エラーメッセージを表示
        }
    }

    async loadRoutes() {
        try {
            const savedRoutes = localStorage.getItem('savedRoutes');
            if (savedRoutes) {
                const routesData = JSON.parse(savedRoutes);
                this.clearRoutes();
                routesData.forEach(routeData => {
                    const route = Route.fromJSON(routeData);
                    this.addRoute(route);
                });
                this.updateRouteList();
                // 成功メッセージを表示
            }
        } catch (error) {
            console.error('進路の読み込みに失敗しました:', error);
            // エラーメッセージを表示
        }
    }

    showGuidance(mode) {
        // ガイドUIは削除されたため何もしない
    }

    hideGuidance() {
        // ガイドUIは削除されたため何もしない
    }

    updateModeIndicator(mode) {
        if (mode === 'none') {
            this.modeIndicator.classList.remove('active', 'auto', 'manual');
        } else {
            this.modeIndicator.classList.add('active', mode);
            this.modeText.textContent = mode === 'auto' ? '自動生成モード' : '手動生成モード';
        }
    }

    // --- 新アルゴリズム: 経路探索（案準拠） ---
    _findAllRoutesFromEndpoint(startTrack, startEpIdx, destButton, destEpIdxFar) {
        const results = [];
        const destTrackId = String(destButton.trackId);
        if (String(startTrack.id) === destTrackId && startEpIdx === destEpIdxFar) return results;

        // trackElementsを明示的に定義
        const trackElements = this.interlockingManager && this.interlockingManager.trackManager && this.interlockingManager.trackManager.tracks
            ? Array.isArray(this.interlockingManager.trackManager.tracks)
                ? this.interlockingManager.trackManager.tracks
                : Array.from(this.interlockingManager.trackManager.tracks.values ? this.interlockingManager.trackManager.tracks.values() : Object.values(this.interlockingManager.trackManager.tracks))
            : [];

        // 多端点trackの物理的に許される端点ペアを返す
        function getAllowedPairs(track) {
            // ダブルクロス
            if (track.type === 'double_cross' || track.type === 'double_slip_x') {
                return [
                    [0,1],[1,0],[2,3],[3,2],[0,3],[3,0],[1,2],[2,1]
                ];
            }
            // 分岐器（point_left, point_right）
            if (track.type && track.type.startsWith('point_')) {
                return [
                    [0,1],[1,0],[0,2],[2,0],[1,2],[2,1]
                ];
            }
            // 通常trackは2端点のみ
            if (track.endpoints && track.endpoints.length === 2) {
                return [[0,1],[1,0]];
            }
            // その他は全ペア許可（安全策）
            const n = track.endpoints ? track.endpoints.length : 2;
            const pairs = [];
            for (let i=0; i<n; ++i) for (let j=0; j<n; ++j) if (i!==j) pairs.push([i,j]);
            return pairs;
        }

        // track内端点間移動が許可されるペアを返す
        function getInternalMovableEndpoints(track, fromEpIdx) {
            const endpoints = [];
            if (track.type === 'straight') {
                // 直線は0⇔1のみ
                if (fromEpIdx === 0) endpoints.push(1);
                else if (fromEpIdx === 1) endpoints.push(0);
            } else if (track.type === 'point_left' || track.type === 'point_right') {
                // 0-1（直進）、0-2（分岐）のみ
                if (fromEpIdx === 0) { endpoints.push(1,2); }
                else if (fromEpIdx === 1 && track.endpoints.length > 1) { endpoints.push(0); }
                else if (fromEpIdx === 2 && track.endpoints.length > 2) { endpoints.push(0); }
            } else if (track.type === 'double_cross' || track.type === 'double_slip_x') {
                // 0-1,2-3（直進）、0-3,1-2（分岐）
                if (fromEpIdx === 0) { endpoints.push(1,3); }
                else if (fromEpIdx === 1) { endpoints.push(0,2); }
                else if (fromEpIdx === 2) { endpoints.push(1,3); }
                else if (fromEpIdx === 3) { endpoints.push(0,2); }
            } else if (track.type === 'crossing') {
                // crossingは0-1,2-3のみ
                if (fromEpIdx === 0) endpoints.push(1);
                else if (fromEpIdx === 1) endpoints.push(0);
                else if (fromEpIdx === 2) endpoints.push(3);
                else if (fromEpIdx === 3) endpoints.push(2);
            }
            return endpoints;
        }
        // track間接続（他trackへのエッジ）
        function getConnections(track, fromEpIdx) {
            const result = [];
            if (track.connections instanceof Map) {
                const conn = track.connections.get(fromEpIdx);
                if (conn) result.push(conn);
            } else if (Array.isArray(track.connections)) {
                for (const [idx, conn] of track.connections) {
                    if (Number(idx) === Number(fromEpIdx)) result.push(conn);
                }
            }
            return result;
        }
        // DFS本体
        const dfs = (track, epIdx, path, trackVisited, pairVisited) => {
            const trackId = String(track.id);
            // 多端点trackかどうか
            const isMulti = (track.type === 'double_cross' || track.type === 'double_slip_x' || (track.type && track.type.startsWith('point_')));
            // 直前のpathからfromEpIdxを取得
            const prev = path.length > 0 ? path[path.length-1] : null;
            let pairKey = null;
            if (isMulti && prev && prev.trackId === trackId) {
                pairKey = `${trackId}:${prev.endpoint}->${epIdx}`;
                // 既にこのtrackで別ペアを通過していたらNG
                const usedPairs = Array.from(pairVisited).filter(k => k.startsWith(trackId+':'));
                if (usedPairs.length > 0 && !usedPairs.includes(pairKey)) {
                    console.debug(`[DFS:SKIP-MULTI] trackId=${trackId} epIdx=${epIdx}（他ペア通過済み） path=`, path.map(p => `${p.trackId}:${p.endpoint}`));
                    return;
                }
                if (pairVisited.has(pairKey)) {
                    console.debug(`[DFS:SKIP-MULTI] trackId=${trackId} epIdx=${epIdx}（同ペア再通過） path=`, path.map(p => `${p.trackId}:${p.endpoint}`));
                    return;
                }
                pairVisited.add(pairKey);
            } else {
                // 通常trackはtrackId単位
                if (trackVisited.has(trackId)) {
                    console.debug(`[DFS:SKIP] trackId=${trackId} epIdx=${epIdx}（既に通過） path=`, path.map(p => `${p.trackId}:${p.endpoint}`));
                    return;
                }
                trackVisited.add(trackId);
            }
            console.debug(`[DFS:ENTER] trackId=${trackId} epIdx=${epIdx} trackVisited=`, Array.from(trackVisited), 'pairVisited=', Array.from(pairVisited), 'path=', path.map(p => `${p.trackId}:${p.endpoint}`));
            // ゴール判定
            if (trackId === destTrackId && epIdx === destEpIdxFar) {
                console.debug(`[DFS:GOAL] path=`, [...path, { trackId, endpoint: epIdx }].map(p => `${p.trackId}:${p.endpoint}`));
                results.push({ path: [...path, { trackId, endpoint: epIdx }] });
                if (isMulti && pairKey) pairVisited.delete(pairKey);
                else trackVisited.delete(trackId);
                return;
            }
            // track内端点間移動
            for (const nextEpIdx of getInternalMovableEndpoints(track, epIdx)) {
                if (nextEpIdx === epIdx) continue;
                dfs(track, nextEpIdx, [...path, { trackId, endpoint: nextEpIdx }], trackVisited, pairVisited);
            }
            // track間移動
            for (const conn of getConnections(track, epIdx)) {
                const nextTrack = trackElements.find(t => String(t.id) === String(conn.trackId));
                if (!nextTrack) continue;
                dfs(nextTrack, conn.endpointIndex, [...path, { trackId: nextTrack.id, endpoint: conn.endpointIndex }], trackVisited, pairVisited);
            }
            if (isMulti && pairKey) pairVisited.delete(pairKey);
            else trackVisited.delete(trackId);
        };
        // DFS探索開始
        dfs(startTrack, startEpIdx, [{ trackId: startTrack.id, endpoint: startEpIdx }], new Set(), new Set());
        // pathの両端が正しい端点かチェック
        const unique = [];
        const seen = new Set();
        for (const r of results) {
            const path = r.path;
            if (
                path.length > 0 &&
                path[0].trackId === String(startTrack.id) &&
                path[0].endpoint === startEpIdx &&
                path[path.length - 1].trackId === destTrackId &&
                path[path.length - 1].endpoint === destEpIdxFar
            ) {
                const key = path.map(s => `${s.trackId}:${s.endpoint}`).join('-');
                if (!seen.has(key)) {
                    unique.push(r);
                    seen.add(key);
                }
            }
        }
        if (unique.length === 0) {
            console.log('[DEBUG:route] 経路候補なし', {
                startTrackId: String(startTrack.id), startEpIdx,
                destTrackId, destEpIdxFar
            });
        }
        return unique;
    }

    showRouteCandidatesModal() {
        // モーダル要素取得
        const modal = document.getElementById('routeModal');
        const modalBody = document.getElementById('routeModalBody');
        if (!modal || !modalBody) return;
        modalBody.innerHTML = '';
        // --- 追加: 「以下の経路を登録する」ボタン ---
        const registerBtn = document.createElement('button');
        registerBtn.textContent = '以下の経路を登録する';
        registerBtn.style.margin = '8px 0 16px 0';
        registerBtn.className = 'route-register-btn';
        registerBtn.onclick = () => {
            modal.classList.remove('show');
            const autoBtn = document.getElementById('autoRouteBtn');
            if (autoBtn) autoBtn.classList.remove('active');
            // --- 追加: 自動生成モードのポップアップを非表示 ---
            const modeIndicator = document.getElementById('modeIndicator');
            if (modeIndicator) modeIndicator.style.display = 'none';
            // 必要なら状態リセット
            delete this.candidateRoutes;
        };
        modalBody.appendChild(registerBtn);
        // 候補リスト
        const header = document.createElement('div');
        header.innerHTML = '<h3 style="margin:8px 0 4px 0; color:#1976D2; font-size:15px;">進路候補テーブル</h3>';
        modalBody.appendChild(header);
        if (!this.routeCandidates || this.routeCandidates.length === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.textContent = '進路候補がありません';
            emptyMsg.style.color = '#888';
            modalBody.appendChild(emptyMsg);
        } else {
            this._clearRouteHighlight(); // 既存ハイライト解除
            this.routeCandidates.forEach((route, idx) => {
                const routeDiv = document.createElement('div');
                routeDiv.className = 'route-item candidate';
                let html = `<div><b>てこ:</b> ${route.startLever.id}　<b>着点:</b> ${route.destButton.id}</div>`;
                html += '<ul style="margin-left:1em;">';
                (route.path || []).forEach(step => {
                    html += `<li>線路ID: ${step.trackId ?? step.id}, 端点: ${step.endpoint ?? ''}, 開通方向: ${step.direction ?? ''}</li>`;
                });
                html += '</ul>';
                routeDiv.innerHTML = html;
                // --- ここでクリックイベントを追加 ---
                routeDiv.addEventListener('click', () => {
                    this._clearRouteHighlight();
                    this._highlightRouteCandidate(route.path, route.pointStates);
                });
                modalBody.appendChild(routeDiv);
            });
        }
        // モーダル表示
        modal.classList.add('show');
    }

    // 進路候補のハイライトをクリア
    _clearRouteHighlight() {
        if (!window.app || !window.app.trackManager) return;
        const tracks = window.app.trackManager.tracks;
        if (typeof tracks.forEach === 'function') {
            tracks.forEach(track => {
                if (track && track.setStatus) track.setStatus('normal');
                if (track && track.isPoint && track.setPointDirection) track.setPointDirection('normal');
            });
        } else if (typeof tracks.values === 'function') {
            for (const track of tracks.values()) {
                if (track && track.setStatus) track.setStatus('normal');
                if (track && track.isPoint && track.setPointDirection) track.setPointDirection('normal');
            }
        }
        if (window.app && window.app.canvas) window.app.canvas.draw();
    }

    // 進路候補のパス・ポイント状態をUIに反映（進路開通時と同じロジック）
    _highlightRouteCandidate(path, pointStates) {
        if (!window.app || !window.app.trackManager) return;
        const tracks = window.app.trackManager.tracks;
        // まず全trackをnormalに
        if (typeof tracks.forEach === 'function') {
            tracks.forEach(track => {
                if (track && track.setStatus) track.setStatus('normal');
                if (track && track.isPoint && track.setPointDirection) track.setPointDirection('normal');
            });
        } else if (typeof tracks.values === 'function') {
            for (const track of tracks.values()) {
                if (track && track.setStatus) track.setStatus('normal');
                if (track && track.isPoint && track.setPointDirection) track.setPointDirection('normal');
            }
        }
        // 経路上のtrackをPREVIEW色に
        path.forEach(step => {
            let track = null;
            if (typeof tracks.get === 'function') {
                track = tracks.get(step.trackId);
            } else if (typeof tracks === 'object') {
                track = tracks[step.trackId] || tracks[Number(step.trackId)];
            }
            if (track && track.setStatus) track.setStatus('PREVIEW');
        });
        // 分岐器のdirectionを「最後の通過step」でセット
        const lastPointStep = {};
        path.forEach(step => {
            if (step.direction && step.trackId) {
                lastPointStep[step.trackId] = step;
            }
        });
        for (const trackId in lastPointStep) {
            let track = null;
            if (typeof tracks.get === 'function') {
                track = tracks.get(trackId);
            } else if (typeof tracks === 'object') {
                track = tracks[trackId] || tracks[Number(trackId)];
            }
            if (track && track.isPoint && track.setPointDirection) {
                track.setPointDirection(lastPointStep[trackId].direction);
            }
        }
        if (window.app && window.app.canvas) window.app.canvas.draw();
    }

    resetAllTracksStatus() {
        // 全ての線路のstatusをnormalに戻す
        if (window.app && window.app.trackManager && window.app.trackManager.tracks) {
            const tracks = window.app.trackManager.tracks;
            if (typeof tracks.forEach === 'function') {
                tracks.forEach(track => {
                    track.setStatus && track.setStatus('normal');
                });
            } else if (typeof tracks === 'object') {
                Object.values(tracks).forEach(track => {
                    track.setStatus && track.setStatus('normal');
                });
            }
        }
        if (window.app && window.app.canvas) window.app.canvas.draw();
    }
}



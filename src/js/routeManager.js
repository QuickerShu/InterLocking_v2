class Route {
    constructor(name, lever, destinationButton, points, isAuto = true) {
        this.id = crypto.randomUUID();
        this.name = name;
        this.lever = lever;           // テコの情報 {id: string, type: string}
        this.destination = destinationButton; // 着点ボタンの情報 {id: string}
        this.points = points;         // [{id: string, position: 'normal' | 'reverse'}]
        this.isAuto = isAuto;
        this.isActive = false;
        this.cost = 0;
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

    // 経路のコストを計算
    calculateCost() {
        let totalCost = 0;
        let consecutiveReverse = 0; // 連続する分岐数

        this.points.forEach((point, index) => {
            // 基本コスト
            if (point.position === 'reverse') {
                totalCost += 1.5; // 分岐の基本コスト
                consecutiveReverse++;
                // 連続する分岐にペナルティを追加
                totalCost += consecutiveReverse * 0.5;
            } else {
                totalCost += 1.0; // 直進の基本コスト
                consecutiveReverse = 0;
            }

            // 方向変更のペナルティ
            if (index > 0) {
                const prevPosition = this.points[index - 1].position;
                if (prevPosition !== point.position) {
                    totalCost += 0.5; // 方向変更のペナルティ
                }
            }
        });

        this.cost = totalCost;
        return totalCost;
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
            if (!leverTrack) return;
            for (const dest of destButtons) {
                const destTrack = trackElementsForGraph.find(t => t.id == dest.trackId);
                if (!destTrack) continue;
                function getConnectedEndpointIndices(track) {
                    let conns = track.connections;
                    if (!Array.isArray(conns)) {
                        if (conns && typeof conns.forEach === 'function') {
                            // Mapの場合
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
                // デバッグ出力
                console.log('leverConnected:', leverConnected, 'destConnected:', destConnected);
                let bestPath = [];
                let minLen = Infinity;
                let bestLeverEpIdx = null;
                let bestDestEpIdx = null;
                leverEpIdxs.forEach(leverEpIdx => {
                    destEpIdxs.forEach(destEpIdx => {
                        const path = this.findOptimalRoute(lever.trackId, dest.trackId);
                        if (path.length > 0 && path.length < minLen) {
                            bestPath = path;
                            minLen = path.length;
                            bestLeverEpIdx = leverEpIdx;
                            bestDestEpIdx = destEpIdx;
                        }
                    });
                });
                console.log(`lever.id=${lever.id}, lever.trackId=${lever.trackId}, leverEpIdxs=${leverEpIdxs}, dest.id=${dest.id}, dest.trackId=${dest.trackId}, destEpIdxs=${destEpIdxs}, bestLeverEpIdx=${bestLeverEpIdx}, bestDestEpIdx=${bestDestEpIdx}`);
                if (bestPath.length > 0) {
                    const route = new Route(
                        `${this.getLeverTypeName(lever.type)} ${this.routes.size + 1}`,
                        lever,
                        dest,
                        bestPath,
                        true
                    );
                    route.calculateCost();
                    if (this.validateRoute(route)) {
                        allCandidates.push(route);
                    }
                }
            }
        });
        console.log('allCandidates.length:', allCandidates.length);
        this.showRouteCandidates(allCandidates);
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
                                // point_left型: 0-1=normal, 0-2=reverse
                                if (track.type === 'point_left') {
                                    if ((i === 0 && j === 1) || (i === 1 && j === 0)) {
                                        posA = posB = 'normal';
                                    } else if ((i === 0 && j === 2) || (i === 2 && j === 0)) {
                                        posA = posB = 'reverse';
                                    } else {
                                        posA = posB = 'track';
                                    }
                                }
                                // point_right型: 0-1=normal, 0-2=reverse
                                else if (track.type === 'point_right') {
                                    if ((i === 0 && j === 1) || (i === 1 && j === 0)) {
                                        posA = posB = 'normal';
                                    } else if ((i === 0 && j === 2) || (i === 2 && j === 0)) {
                                        posA = posB = 'reverse';
                                    } else {
                                        posA = posB = 'track';
                                    }
                                }
                                // double_cross: 0-1,2-3=normal, 0-2,1-3=reverse
                                else if (track.type === 'double_cross') {
                                    if (((i === 0 && j === 1) || (i === 1 && j === 0)) || ((i === 2 && j === 3) || (i === 3 && j === 2))) {
                                        posA = posB = 'normal';
                                    } else if (((i === 0 && j === 2) || (i === 2 && j === 0)) || ((i === 1 && j === 3) || (i === 3 && j === 1))) {
                                        posA = posB = 'reverse';
                                    } else {
                                        posA = posB = 'track';
                                    }
                                }
                                // double_slip_x: 0-1,2-3=normal, 0-3,1-2=reverse
                                else if (track.type === 'double_slip_x') {
                                    if (((i === 0 && j === 1) || (i === 1 && j === 0)) || ((i === 2 && j === 3) || (i === 3 && j === 2))) {
                                        posA = posB = 'normal';
                                    } else if (((i === 0 && j === 3) || (i === 3 && j === 0)) || ((i === 1 && j === 2) || (i === 2 && j === 1))) {
                                        posA = posB = 'reverse';
                                    } else {
                                        posA = posB = 'track';
                                    }
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
        // アクティブな進路との競合チェック
        for (const activeRoute of this.activeRoutes) {
            if (this.checkRouteConflict(route, activeRoute)) {
                return false;
            }
        }
        return true;
    }

    // 複数の経路候補を生成
    generateRouteCandidates(startId, endId) {
        const candidates = [];
        
        // 基本の最短経路を探索
        const baseRoute = this.findOptimalRoute(startId, endId, new Map());
        if (baseRoute.length > 0) {
            candidates.push(baseRoute);
        }

        // 代替経路の探索
        for (let i = 0; i < this.maxCandidates - 1; i++) {
            const excludedPoints = new Map();
            
            // 既存の経路で使用されているポイントにペナルティを設定
            candidates.forEach(route => {
                route.forEach(point => {
                    excludedPoints.set(point.id, (excludedPoints.get(point.id) || 0) + 2.0);
                });
            });

            // 新しい経路を探索
            const alternativeRoute = this.findOptimalRoute(startId, endId, excludedPoints);
            if (alternativeRoute.length > 0 && 
                !this.isRouteDuplicate(alternativeRoute, candidates)) {
                candidates.push(alternativeRoute);
            }
        }

        return candidates;
    }

    // 経路が重複していないかチェック
    isRouteDuplicate(newRoute, existingRoutes) {
        const newRouteStr = JSON.stringify(newRoute.map(p => p.id));
        return existingRoutes.some(route => 
            JSON.stringify(route.map(p => p.id)) === newRouteStr
        );
    }

    // 最適経路探索（端点ノードグラフ対応）
    findOptimalRoute(startTrackId, endTrackId, additionalCosts = new Map()) {
        // デバッグ出力を追加
        console.log('findOptimalRoute called:', startTrackId, endTrackId, 'trackGraph keys:', Array.from(this.trackGraph.keys()));
        const startNodeIds = [
            `${startTrackId}:0`,
            `${startTrackId}:1`
        ].filter(id => this.trackGraph.has(id));
        const endNodeIds = [
            `${endTrackId}:0`,
            `${endTrackId}:1`
        ].filter(id => this.trackGraph.has(id));
        console.log('startNodeIds:', startNodeIds, 'endNodeIds:', endNodeIds);
        if (startNodeIds.length === 0 || endNodeIds.length === 0) {
            return [];
        }

        // 2. 全ての始点-終点ペアで最短経路を探索し、最も短いものを採用
        let bestPath = [];
        let minCost = Infinity;
        for (const sId of startNodeIds) {
            for (const eId of endNodeIds) {
                const path = this._findOptimalPathBetweenNodes(sId, eId, additionalCosts);
                if (path.length > 0 && path.length < minCost) {
                    bestPath = path;
                    minCost = path.length;
                }
            }
        }
        return bestPath;
    }

    // 端点ノード間の最短経路探索（Dijkstra/BFS）
    _findOptimalPathBetweenNodes(startId, endId, additionalCosts = new Map()) {
        // 追加: ノードIDとグラフのキーを出力
        console.log('startId:', startId, 'endId:', endId, 'trackGraph keys:', Array.from(this.trackGraph.keys()));
        if (!this.trackGraph.has(startId) || !this.trackGraph.has(endId)) {
            return [];
        }
        const distances = new Map();
        const previous = new Map();
        const unvisited = new Set();

        // 初期化
        this.trackGraph.forEach((node, id) => {
            distances.set(id, id === startId ? 0 : Infinity);
            previous.set(id, null);
            unvisited.add(id);
        });

        let step = 0;
        while (unvisited.size > 0) {
            let currentId = null;
            let minDistance = Infinity;
            unvisited.forEach(id => {
                const distance = distances.get(id);
                if (distance < minDistance) {
                    minDistance = distance;
                    currentId = id;
                }
            });
            if (currentId === null || currentId === endId) break;
            unvisited.delete(currentId);
            const currentNode = this.trackGraph.get(currentId);
            // デバッグ出力
            console.log(`[step ${step}] currentId=${currentId}, distance=${distances.get(currentId)}`);
            currentNode.connections.forEach((connection, neighborId) => {
                if (!unvisited.has(neighborId)) return;
                let connectionCost = connection.cost;
                if (additionalCosts.has(neighborId)) {
                    connectionCost += additionalCosts.get(neighborId);
                }
                const newDistance = distances.get(currentId) + connectionCost;
                // デバッグ出力
                console.log(`  neighborId=${neighborId}, oldDist=${distances.get(neighborId)}, newDist=${newDistance}`);
                if (newDistance < distances.get(neighborId)) {
                    distances.set(neighborId, newDistance);
                    previous.set(neighborId, {
                        id: currentId,
                        position: connection.position
                    });
                }
            });
            step++;
        }
        // デバッグ: 最終的なdistances, previous
        console.log('final distances:', distances);
        console.log('final previous:', previous);

        // 経路の再構築
        const path = [];
        let current = endId;
        let prev = previous.get(current);
        while (prev) {
            // prev.id から current へのエッジのpositionを取得
            let position = 'track';
            const prevNode = this.trackGraph.get(prev.id);
            if (prevNode && prevNode.connections.has(current)) {
                position = prevNode.connections.get(current).position;
            }
            path.unshift({
                id: prev.id,
                nextId: current,
                position: position
            });
            current = prev.id;
            prev = previous.get(current);
        }
        // 最後のノード（始点）
        if (path.length > 0 && path[0].id !== startId) {
            // 始点が含まれていない場合は無効
            return [];
        }
        // 終点を追加
        path.push({ id: endId, nextId: null, position: 'track' });
        return path;
    }

    async generateAutoRoute() {
        try {
            const trackElements = Array.from(document.querySelectorAll('[data-track-element]'))
                .map(el => ({
                    id: el.dataset.trackId,
                    type: el.dataset.trackType,
                    normalConnection: el.dataset.normalConnection ? 
                        { id: el.dataset.normalConnection } : null,
                    reverseConnection: el.dataset.reverseConnection ?
                        { id: el.dataset.reverseConnection } : null
                }));

            this.buildTrackGraph(trackElements);

            // テコと着点ボタン間の経路を探索
            const candidates = this.generateRouteCandidates(
                this.selectedLever.id, 
                this.selectedDestination.id
            );

            // 進路候補リストを生成
            if (candidates.length > 0) {
                const validCandidates = candidates
                    .map(points => {
                        const route = new Route(
                            `${this.getLeverTypeName(this.selectedLever.type)} 候補${this.routes.size + 1}`,
                            this.selectedLever,
                            this.selectedDestination,
                            points,
                            true
                        );
                        route.calculateCost();
                        return route;
                    })
                    .filter(route => this.validateRoute(route))
                    .sort((a, b) => a.cost - b.cost);

                // 進路候補リストを画面に表示
                this.showRouteCandidates(validCandidates);
            } else {
                throw new Error('有効な進路が見つかりません');
            }
        } catch (error) {
            console.error('進路生成エラー:', error);
            alert(`進路生成エラー: ${error.message}`);
        } finally {
            this.exitAutoMode();
        }
    }

    // 進路候補リストを画面に表示するメソッドを追加
    showRouteCandidates(candidates) {
        // モーダル要素取得
        const modal = document.getElementById('routeModal');
        const modalBody = document.getElementById('routeModalBody');
        // モーダル内容クリア
        modalBody.innerHTML = '';
        // 候補リスト
        const candidateHeader = document.createElement('div');
        candidateHeader.innerHTML = '<h3 style="margin:8px 0 4px 0; color:#1976D2; font-size:15px;">進路自動生成候補</h3>';
        modalBody.appendChild(candidateHeader);
        candidates.forEach((route, idx) => {
            const routeElement = document.createElement('div');
            routeElement.className = 'route-item candidate';
            // 経路情報を整形
            let routeInfo = '';
            if (route.points && route.points.length > 0) {
            for (let i = 0; i < route.points.length - 1; i++) {
                const curr = route.points[i];
                const next = route.points[i + 1];
                    const currTrackId = curr.id ? curr.id.split(':')[0] : '';
                    const currEpIdx = curr.id ? curr.id.split(':')[1] : '';
                    const nextEpIdx = next.id ? next.id.split(':')[1] : '';
                // track情報取得
                let track = null;
                if (window.app && window.app.trackManager && window.app.trackManager.tracks) {
                    const tracks = window.app.trackManager.tracks;
                    if (Array.isArray(tracks)) {
                        track = tracks.find(t => String(t.id) === currTrackId);
                    } else if (typeof tracks.get === 'function') {
                        track = tracks.get(currTrackId) || tracks.get(Number(currTrackId));
                    } else if (typeof tracks === 'object') {
                        track = tracks[currTrackId] || tracks[Number(currTrackId)];
                    }
                }
                // 分岐器のいずれの端点から出入りする場合も方向を明示
                let stepStr = `線路${currTrackId} 端点${currEpIdx}→${nextEpIdx}`;
                if (track && track.isPoint) {
                    // point_left, point_right, double_cross, double_slip_x で方向判定
                    let showDirection = false;
                    if (track.type === 'point_left' || track.type === 'point_right') {
                        if ((currEpIdx === '0' && nextEpIdx === '1') || (currEpIdx === '1' && nextEpIdx === '0')) {
                            showDirection = true;
                            if (curr.position === 'normal') stepStr += ' [分岐器: 直進]';
                            else if (curr.position === 'reverse') stepStr += ' [分岐器: 分岐]';
                        } else if ((currEpIdx === '0' && nextEpIdx === '2') || (currEpIdx === '2' && nextEpIdx === '0')) {
                            showDirection = true;
                            if (curr.position === 'reverse') stepStr += ' [分岐器: 分岐]';
                            else if (curr.position === 'normal') stepStr += ' [分岐器: 直進]';
                        }
                    } else if (track.type === 'double_cross') {
                        if (((currEpIdx === '0' && nextEpIdx === '1') || (currEpIdx === '1' && nextEpIdx === '0')) || ((currEpIdx === '2' && nextEpIdx === '3') || (currEpIdx === '3' && nextEpIdx === '2'))) {
                            showDirection = true;
                            if (curr.position === 'normal') stepStr += ' [分岐器: 直進]';
                            else if (curr.position === 'reverse') stepStr += ' [分岐器: 分岐]';
                        } else if (((currEpIdx === '0' && nextEpIdx === '2') || (currEpIdx === '2' && nextEpIdx === '0')) || ((currEpIdx === '1' && nextEpIdx === '3') || (currEpIdx === '3' && nextEpIdx === '1'))) {
                            showDirection = true;
                            if (curr.position === 'reverse') stepStr += ' [分岐器: 分岐]';
                            else if (curr.position === 'normal') stepStr += ' [分岐器: 直進]';
                        }
                    } else if (track.type === 'double_slip_x') {
                        if (((currEpIdx === '0' && nextEpIdx === '1') || (currEpIdx === '1' && nextEpIdx === '0')) || ((currEpIdx === '2' && nextEpIdx === '3') || (currEpIdx === '3' && nextEpIdx === '2'))) {
                            showDirection = true;
                            if (curr.position === 'normal') stepStr += ' [分岐器: 直進]';
                            else if (curr.position === 'reverse') stepStr += ' [分岐器: 分岐]';
                        } else if (((currEpIdx === '0' && nextEpIdx === '3') || (currEpIdx === '3' && nextEpIdx === '0')) || ((currEpIdx === '1' && nextEpIdx === '2') || (currEpIdx === '2' && nextEpIdx === '1'))) {
                            showDirection = true;
                            if (curr.position === 'reverse') stepStr += ' [分岐器: 分岐]';
                            else if (curr.position === 'normal') stepStr += ' [分岐器: 直進]';
                        }
                    }
                }
                routeInfo += stepStr + ' → ';
            }
            // 最後の端点
            const last = route.points[route.points.length - 1];
                if (last && last.id) {
            const lastTrackId = last.id.split(':')[0];
            const lastEpIdx = last.id.split(':')[1];
            routeInfo += `線路${lastTrackId} 端点${lastEpIdx}`;
                }
            } else {
                routeInfo = '経路情報がありません';
            }
            routeElement.innerHTML = `
                <div class=\"route-header\">\n                    <span class=\"route-name\">${route.name}</span>\n                    <span class=\"route-generation-mode auto\">自動生成候補</span>\n                    <div class=\"route-actions\">\n                        <button class=\"route-action-btn\" onclick=\"routeManager.addRouteFromCandidate(${idx})\">追加</button>\n                    </div>\n                </div>\n                <div class=\"route-details\">\n                    <div>テコ: ${this.getLeverTypeName(route.lever.type)}</div>\n                    <div>着点: 着点ボタン ${route.destination.id}</div>\n                    <div class=\"route-points\">${routeInfo}</div>\n                    <div>コスト: ${route.cost}</div>\n                </div>\n            `;
            modalBody.appendChild(routeElement);
        });
        // 区切り線
        const hr = document.createElement('hr');
        hr.style.margin = '16px 0 8px 0';
        modalBody.appendChild(hr);
        // 登録済み進路リスト
        const registeredHeader = document.createElement('div');
        registeredHeader.innerHTML = '<h3 style="margin:8px 0 4px 0; color:#1976D2; font-size:15px;">登録済み進路一覧</h3>';
        modalBody.appendChild(registeredHeader);
        if (this.routes.size === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.textContent = '登録済み進路はありません';
            emptyMsg.style.color = '#888';
            modalBody.appendChild(emptyMsg);
        } else {
            this.routes.forEach(route => {
                const routeElement = document.createElement('div');
                routeElement.className = 'route-item';
                routeElement.innerHTML = `
                    <div class=\"route-header\">
                        <span class=\"route-name\">${route.name}</span>
                        <span class=\"route-generation-mode ${route.isAuto ? 'auto' : 'manual'}\">
                            ${route.isAuto ? '自動生成' : '手動生成'}
                        </span>
                        <div class=\"route-actions\">
                            <button class=\"route-action-btn\" onclick=\"routeManager.activateRoute('${route.id}')\">
                                ${route.isActive ? '解除' : '設定'}
                            </button>
                            <button class=\"route-action-btn delete\" onclick=\"routeManager.removeRoute('${route.id}')\">
                                削除
                            </button>
                        </div>
                    </div>
                    <div class=\"route-details\">
                        <div>テコ: ${this.getLeverTypeName(route.lever.type)}</div>
                        <div>着点: 着点ボタン ${route.destination.id}</div>
                        <div class=\"route-points\">
                            ${route.points.map(p => `
                                <div class=\"route-point\">
                                    <span>ポイント: ${p.id}</span>
                                    <span>位置: ${p.position === 'normal' ? '直進' : '分岐'}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
                modalBody.appendChild(routeElement);
            });
        }
        // モーダル表示
        modal.style.display = 'flex';
        // 閉じるボタンイベント
        const closeBtn = document.getElementById('closeRouteModalBtn');
        if (closeBtn) {
            closeBtn.onclick = () => {
                modal.style.display = 'none';
                this.exitAutoMode(); // モードを必ずオフにする
            };
        }
        // 候補を一時保存
        this.candidateRoutes = candidates;
    }

    // 進路候補から追加するメソッドを追加
    addRouteFromCandidate(idx) {
        if (this.candidateRoutes && this.candidateRoutes[idx]) {
            const route = this.candidateRoutes[idx];
            this.addRoute(route);
            this.updateRouteList();
            delete this.candidateRoutes; // 候補リストを消す
        }
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
        this.routes.clear();
        this.updateRouteList();
    }

    updateRouteList() {
        this.routeList.innerHTML = '';
        
        this.routes.forEach(route => {
            const routeElement = document.createElement('div');
            routeElement.className = 'route-item';
            // 分岐器（ポイント）のみ抽出し詳細表示
            const pointDetails = route.points
                .map((p, idx) => {
                    // trackId取得
                    const trackId = p.trackId || p.id;
                    // track取得
                    let track = null;
                    if (window.app && window.app.trackManager && window.app.trackManager.tracks) {
                        const tracks = window.app.trackManager.tracks;
                        if (typeof tracks.get === 'function') {
                            track = tracks.get(trackId) || tracks.get(String(trackId)) || tracks.get(Number(trackId));
                        } else if (typeof tracks === 'object') {
                            track = tracks[trackId] || tracks[String(trackId)] || tracks[Number(trackId)];
                        }
                    }
                    if (track && track.isPoint) {
                        const ep = p.endpoint !== undefined ? `端点: ${p.endpoint}` : '';
                        const dir = p.direction !== undefined ? `方向: ${p.direction}` : '';
                        const pos = p.position !== undefined ? `位置: ${p.position === 'normal' ? '直進' : p.position === 'reverse' ? '分岐' : p.position}` : '';
                        return `<div class=\"route-point\"><span>分岐器: ${trackId}</span> <span>${ep}</span> <span>${dir}</span> <span>${pos}</span></div>`;
                    }
                    return '';
                })
                .filter(html => html)
                .join('');
            routeElement.innerHTML = `
                <div class=\"route-header\">
                    <span class=\"route-name\">${route.name}</span>
                    <span class=\"route-generation-mode ${route.isAuto ? 'auto' : 'manual'}\">${route.isAuto ? '自動生成' : '手動生成'}</span>
                    <div class=\"route-actions\">
                        <button class=\"route-action-btn\" onclick=\"routeManager.activateRoute('${route.id}')\">${route.isActive ? '解除' : '設定'}</button>
                        <button class=\"route-action-btn delete\" onclick=\"routeManager.removeRoute('${route.id}')\">削除</button>
                    </div>
                </div>
                <div class=\"route-details\">
                    <div>テコ: ${this.getLeverTypeName(route.lever.type)}</div>
                    <div>着点: 着点ボタン ${route.destination.id}</div>
                    <div class=\"route-points\">${pointDetails || '<span style=\"color:#888\">分岐器はありません</span>'}</div>
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
        }

        // 進路構成中の全線路をROUTE色に
        if (window.app && window.app.trackManager) {
            const tracks = window.app.trackManager.tracks;
            if (route.points && Array.isArray(route.points)) {
                for (let idx = 0; idx < route.points.length; idx++) {
                    const step = route.points[idx];
                    let track = null;
                    if (typeof tracks.get === 'function') {
                        track = tracks.get(step.trackId) || tracks.get(String(step.trackId)) || tracks.get(Number(step.trackId));
                    } else if (typeof tracks === 'object') {
                        track = tracks[step.trackId] || tracks[String(step.trackId)] || tracks[Number(step.trackId)];
                    }
                    if (track) {
                        track.setStatus && track.setStatus('ROUTE');
                        if (track.isPoint) {
                            const dir = step.direction || (route.pointStates && route.pointStates[track.id]) || 'normal';
                            if (track.setPointDirection) {
                                await track.setPointDirection(dir);
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
            modal.style.display = 'flex';
            const cleanup = () => {
                modal.style.display = 'none';
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

    // 進路自動生成・候補生成・経路探索・UI表示などの既存メソッドを全て削除
    // 新しい進路生成アルゴリズム実装のための空メソッドを用意
    generateAllRouteCandidates() {
        // 進路候補テーブルを初期化
        this.routeCandidates = [];
        const startLevers = this.interlockingManager.startLevers || [];
        const destButtons = this.interlockingManager.destinationButtons || [];
        if (!startLevers.length || !destButtons.length) {
            // UI側でエラー表示すること
            return;
        }
        // てこ×着点ボタンの全組み合わせ
        for (const lever of startLevers) {
            for (const button of destButtons) {
                // てこに関連付けられた線路IDの両端点から探索
                const track = this.interlockingManager.trackManager.getTrack(lever.trackId);
                if (!track) continue;
                // 着点trackの遠い端点を取得
                const destTrack = this.interlockingManager.trackManager.getTrack(button.trackId);
                let destEpIdxFar = 0;
                if (destTrack && Array.isArray(destTrack.endpoints) && destTrack.endpoints.length >= 2) {
                    let maxDist = -Infinity;
                    destTrack.endpoints.forEach((ep, idx) => {
                        const dx = ep.x - button.x;
                        const dy = ep.y - button.y;
                        const dist = dx * dx + dy * dy;
                        if (dist > maxDist) {
                            maxDist = dist;
                            destEpIdxFar = idx;
                        }
                    });
                }
                // てこtrackの遠い端点を取得
                let leverEpIdxFar = 0;
                if (track && Array.isArray(track.endpoints) && track.endpoints.length >= 2) {
                    let maxDist = -Infinity;
                    track.endpoints.forEach((ep, idx) => {
                        const dx = ep.x - lever.x;
                        const dy = ep.y - lever.y;
                        const dist = dx * dx + dy * dy;
                        if (dist > maxDist) {
                            maxDist = dist;
                            leverEpIdxFar = idx;
                        }
                    });
                }
                // 遠い端点のみでDFS
                const routes = this._findAllRoutesFromEndpoint(track, leverEpIdxFar, button, destEpIdxFar);
                // 最短経路のみを候補に
                let minLen = Infinity;
                let bestRoute = null;
                for (const route of routes) {
                    if (route.path.length < minLen) {
                        minLen = route.path.length;
                        bestRoute = route;
                    }
                }
                if (bestRoute) {
                    this.routeCandidates.push({
                        startLever: lever,
                        destButton: button,
                        path: bestRoute.path,
                        pointStates: bestRoute.pointStates
                    });
                }
            }
        }
        console.log('this.routeCandidates:', this.routeCandidates);
        // --- 追加: routeCandidatesを自動的にroutesへ登録 ---
        this.routeCandidates.forEach(candidate => {
            const route = new Route(
                `${this.getLeverTypeName(candidate.startLever.type)} ${this.routes.size + 1}`,
                candidate.startLever,
                candidate.destButton,
                candidate.path,
                true
            );
            route.calculateCost();
            this.addRoute(route);
        });
        this.updateRouteList();
    }

    // 経路探索本体（DFS、分岐器等は全方向考慮）
    _findAllRoutesFromEndpoint(startTrack, startEpIdx, destButton, destEpIdxFar) {
        // DFS探索用の内部関数
        const results = [];
        const visited = new Set(); // "trackId:endpointIndex" 形式
        const pointStates = {};

        // 着点ボタンのtrackId, endpointIndexを取得
        const destTrackId = String(destButton.trackId);
        // 着点ボタンの端点indexを特定（最も近い端点と遠い端点の両方を取得）
        let destEpIdxNear = 0;
        if (destButton.x !== undefined && destButton.y !== undefined && startTrack.trackManager) {
            const destTrack = startTrack.trackManager.getTrack(destTrackId);
            if (destTrack && Array.isArray(destTrack.endpoints) && destTrack.endpoints.length >= 2) {
                let minDist = Infinity;
                destTrack.endpoints.forEach((ep, idx) => {
                    const dx = ep.x - destButton.x;
                    const dy = ep.y - destButton.y;
                    const dist = dx * dx + dy * dy;
                    if (dist < minDist) {
                        minDist = dist;
                        destEpIdxNear = idx;
                    }
                });
            }
        }

        // DFS本体
        const dfs = (track, epIdx, path, pointStates) => {
            // デバッグログ追加
            console.log('[DFS] track.id:', track.id, 'epIdx:', epIdx, 'visited:', Array.from(visited));
            const key = `${track.id}:${epIdx}`;
            if (visited.has(key)) return;
            visited.add(key);

            // ゴール判定: track.idがdestTrackIdならゴール（端点番号は問わない）
            if (String(track.id) === destTrackId) {
                // 分岐器ならdirectionをstepに含める
                let step = { trackId: track.id, endpoint: epIdx };
                if (track.isPoint && pointStates[track.id]) {
                    step.direction = pointStates[track.id];
                }
                results.push({
                    path: [...path, step],
                    pointStates: { ...pointStates }
                });
                visited.delete(key);
                return;
            }

            // 端点に接続がなければ終了
            let conn = null;
            if (track.getConnection) {
                conn = track.getConnection(epIdx);
            } else if (track.connections) {
                if (typeof track.connections.get === 'function') {
                    conn = track.connections.get(epIdx);
                } else if (Array.isArray(track.connections)) {
                    // [ [endpointIndex, conn], ... ] 形式
                    const found = track.connections.find(([idx, _]) => idx === epIdx);
                    if (found) conn = found[1];
                }
            }
            if (conn) {
                // 次のtrack, endpointIndex
                let nextTrack = null;
                if (track.trackManager) {
                    nextTrack = track.trackManager.getTrack(conn.trackId);
                } else if (this.interlockingManager && this.interlockingManager.trackManager) {
                    nextTrack = this.interlockingManager.trackManager.getTrack(conn.trackId);
                }
                if (nextTrack) {
                    // 分岐器の場合は両方向を試す
                    if (nextTrack.isPoint) {
                        ['normal', 'reverse'].forEach(dir => {
                            pointStates[nextTrack.id] = dir;
                            let nextEpIdx = null;
                            if (nextTrack.type === 'point_left') {
                                if (dir === 'normal') {
                                    nextEpIdx = conn.endpointIndex === 0 ? 1 : 0;
                                } else {
                                    nextEpIdx = conn.endpointIndex === 0 ? 2 : 0;
                                }
                            } else if (nextTrack.type === 'point_right') {
                                if (dir === 'normal') {
                                    nextEpIdx = conn.endpointIndex === 0 ? 1 : 0;
                                } else {
                                    nextEpIdx = conn.endpointIndex === 0 ? 2 : 0;
                                }
                            } else {
                                nextEpIdx = conn.endpointIndex;
                            }
                            if (nextEpIdx !== null && nextEpIdx !== epIdx) {
                                // 今いるtrackが分岐器ならdirectionをstepに含める
                                let step = { trackId: track.id, endpoint: epIdx };
                                if (track.isPoint && pointStates[track.id]) {
                                    step.direction = pointStates[track.id];
                                }
                                dfs(nextTrack, nextEpIdx, [...path, step], pointStates);
                            }
                            delete pointStates[nextTrack.id];
                        });
                    } else {
                        // 今いるtrackが分岐器ならdirectionをstepに含める
                        let step = { trackId: track.id, endpoint: epIdx };
                        if (track.isPoint && pointStates[track.id]) {
                            step.direction = pointStates[track.id];
                        }
                        dfs(nextTrack, conn.endpointIndex, [...path, step], pointStates);
                    }
                }
            }
            // --- 追加: 同じtrack内の他の端点にも移動 ---
            if (Array.isArray(track.endpoints)) {
                for (let i = 0; i < track.endpoints.length; i++) {
                    if (i !== epIdx) {
                        // 今いるtrackが分岐器ならdirectionをstepに含める
                        let step = { trackId: track.id, endpoint: i };
                        if (track.isPoint && pointStates[track.id]) {
                            step.direction = pointStates[track.id];
                        }
                        dfs(track, i, [...path, step], pointStates);
                    }
                }
            }
            visited.delete(key);
        };

        dfs(startTrack, startEpIdx, [], {});
        return results;
    }

    showRouteCandidatesModal() {
        // モーダル要素取得
        const modal = document.getElementById('routeModal');
        const modalBody = document.getElementById('routeModalBody');
        if (!modal || !modalBody) return;
        modalBody.innerHTML = '';
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
        modal.style.display = 'block';
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

    // 進路候補のパス・ポイント状態をUIに反映
    _highlightRouteCandidate(path, pointStates) {
        if (!window.app || !window.app.trackManager) return;
        const tracks = window.app.trackManager.tracks;
        // パス上の線路をハイライト
        path.forEach(step => {
            let track = null;
            if (typeof tracks.get === 'function') {
                track = tracks.get(step.trackId);
            } else if (typeof tracks === 'object') {
                track = tracks[step.trackId] || tracks[Number(step.trackId)];
            }
            if (track && track.setStatus) track.setStatus('selected');
            // 分岐器の場合は仮想的に方向を反映
            if (track && track.isPoint && pointStates && pointStates[track.id]) {
                if (track.setPointDirection) track.setPointDirection(pointStates[track.id]);
            }
        });
        if (window.app && window.app.canvas) window.app.canvas.draw();
    }
}



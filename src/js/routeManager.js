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
            if (!leverTrack) {
                console.log('[AUTO:SKIP] leverTrackが見つからない:', lever);
                return;
            }
            for (const dest of destButtons) {
                const destTrack = trackElementsForGraph.find(t => t.id == dest.trackId);
                if (!destTrack) {
                    console.log('[AUTO:SKIP] destTrackが見つからない:', dest);
                    continue;
                }
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
                // デバッグ出力
                console.log('[AUTO:COMBO] lever:', lever, 'dest:', dest, 'leverTrack:', leverTrack, 'destTrack:', destTrack);
                console.log('[AUTO:COMBO] leverEpIdxs:', leverEpIdxs, 'destEpIdxs:', destEpIdxs);
                leverEpIdxs.forEach(leverEpIdx => {
                    destEpIdxs.forEach(destEpIdx => {
                        console.log('[AUTO:DFS_CALL] lever:', lever, 'dest:', dest, 'leverEpIdx:', leverEpIdx, 'destEpIdx:', destEpIdx);
                        // DFSで候補を生成
                        const candidates = this._findAllRoutesFromEndpoint(leverTrack, leverEpIdx, dest, destEpIdx);
                        if (!candidates || candidates.length === 0) {
                            console.log('[AUTO:DFS_RESULT] 候補なし lever:', lever, 'dest:', dest, 'leverEpIdx:', leverEpIdx, 'destEpIdx:', destEpIdx);
                        } else {
                            console.log('[AUTO:DFS_RESULT] 候補数:', candidates.length, 'lever:', lever, 'dest:', dest, 'leverEpIdx:', leverEpIdx, 'destEpIdx:', destEpIdx);
                        }
                        candidates.forEach(c => {
                            const route = new Route(
                                `${this.getLeverTypeName(lever.type)} ${this.routes.size + 1}`,
                                lever,
                                dest,
                                c.path,
                                true
                            );
                            if (this.validateRoute(route)) {
                                // 重複チェック（同じpoints配列のものは除外）
                                if (!allCandidates.some(r => JSON.stringify(r.points) === JSON.stringify(route.points))) {
                                    allCandidates.push(route);
                                }
                            }
                        });
                    });
                });
            }
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
        // アクティブな進路との競合チェック
        for (const activeRoute of this.activeRoutes) {
            if (this.checkRouteConflict(route, activeRoute)) {
                return false;
            }
        }
        return true;
    }

    async generateAutoRoute() {
        try {
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
        // 内部状態として候補リストを保持
        this._routeCandidatesPanelList = candidates.slice();
        const render = () => {
            panel.innerHTML = '';
            const candidates = this._routeCandidatesPanelList;
            if (!candidates || candidates.length === 0) {
                panel.innerHTML = '<p>進路候補がありません</p>';
                return;
            }
            // 登録ボタン
            const registerBtn = document.createElement('button');
            registerBtn.textContent = '登録';
            registerBtn.style.margin = '8px 0 16px 0';
            registerBtn.className = 'route-register-btn';
            registerBtn.onclick = () => {
                candidates.forEach(route => {
                    this.addRoute(route);
                });
                this.updateRouteList();
                panel.innerHTML = '<p>進路候補を登録しました。</p>';
                // 自動生成モードをオフ
                this.exitAutoMode();
                // modeIndicatorを非表示
                const modeIndicator = document.getElementById('modeIndicator');
                if (modeIndicator) modeIndicator.style.display = 'none';
            };
            panel.appendChild(registerBtn);
            // 候補リスト
            const header = document.createElement('div');
            header.innerHTML = '<h3 style="margin:8px 0 4px 0; color:#1976D2; font-size:15px;">進路候補リスト</h3>';
            panel.appendChild(header);
            candidates.forEach((route, idx) => {
                const routeDiv = document.createElement('div');
                routeDiv.className = 'route-item candidate';
                let html = `<div><b>てこ:</b> ${route.lever.name || route.lever.id}　<b>着点:</b> ${route.destination.name || route.destination.id}`;
                html += ` <button style="margin-left:8px;" class="delete-candidate-btn">削除</button></div>`;
                html += '<ul style="margin-left:1em;">';
                (route.points || []).forEach(step => {
                    html += `<li>線路ID: ${step.trackId ?? step.id}, 端点: ${step.endpoint ?? ''}, 開通方向: ${step.direction ?? ''}</li>`;
                });
                html += '</ul>';
                routeDiv.innerHTML = html;
                // 削除ボタンのイベント
                routeDiv.querySelector('.delete-candidate-btn').onclick = () => {
                    this._routeCandidatesPanelList.splice(idx, 1);
                    render();
                };
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
                            // 分岐器は「最後の出口stepのdirection」だけを採用
                            const dir = lastDirectionByPoint[trackId] || 'normal';
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

    // 経路探索本体（DFS、分岐器等は全方向考慮）
    _findAllRoutesFromEndpoint(startTrack, startEpIdx, destButton, destEpIdxFar) {
        // DFS探索用の内部関数
        const results = [];
        const visited = new Set(); // "trackId:endpointIndex" 形式
        const trackPassCount = new Map(); // trackIdごとの通過回数を記録
        const pointStates = {};

        // 着点ボタンのtrackId, endpointIndexを取得
        const destTrackId = String(destButton.trackId);

        // てこと着点ボタンが同じ線路上にある場合は進路生成しない
        if (String(startTrack.id) === destTrackId) {
            console.log('[DFS] てこと着点ボタンが同じ線路上にあるため進路生成をスキップ');
            return results;
        }

        // DFS本体
        const dfs = (track, epIdx, path, pointStates) => {
            // 分岐器内での折り返し（端点X→端点0→端点Y, X≠0, Y≠0, X≠Y）を除外
            if (path.length >= 2) {
                const prevStep = path[path.length - 2];
                const lastStep = path[path.length - 1];
                if (
                    track.isPoint &&
                    prevStep.trackId === track.id &&
                    lastStep.trackId === track.id &&
                    lastStep.endpoint === 0 &&
                    epIdx !== 0 &&
                    prevStep.endpoint !== 0 &&
                    prevStep.endpoint !== epIdx
                ) {
                    console.log(`[DFS] 分岐器${track.id}内で端点${prevStep.endpoint}→0→${epIdx}の折り返しを棄却: path=`, path.map(p => `${p.trackId}:${p.endpoint}`));
                    return;
                }
            }
            // デバッグログ追加
            console.log('[DFS] track.id:', track.id, 'epIdx:', epIdx, 'visited:', Array.from(visited), 'path:', path.map(p => `${p.trackId}:${p.endpoint}`));
            const key = `${track.id}:${epIdx}`;
            if (visited.has(key)) {
                console.log(`[DFS] track.id: ${track.id} epIdx: ${epIdx} は訪問済みのため棄却`);
                return;
            }

            // --- ダブルクロス通過回数チェック ---
            let isDoubleCross = track.type === 'double_cross';
            let doubleCrossCount = trackPassCount.get(track.id) || 0;
            if (isDoubleCross) {
                if (doubleCrossCount >= 1) {
                    console.log(`[DFS] ダブルクロス${track.id}の通過回数が1回を超えたため探索中止: path=`, path.map(p => `${p.trackId}:${p.endpoint}`));
                    return;
                }
            }

            // --- 修正: 直前のstepが同じtrack内の端点間移動なら通過回数を増やさない ---
            let currentCount = trackPassCount.get(track.id) || 0;
            if (path.length === 0 || path[path.length - 1].trackId !== track.id) {
                // 目的地以外の線路で2回以上の通過は禁止
                if (currentCount >= 2 && String(track.id) !== destTrackId) {
                    console.log(`[DFS] 線路${track.id}の通過回数が上限を超えたため探索中止: path=`, path.map(p => `${p.trackId}:${p.endpoint}`));
                    return;
                }
                trackPassCount.set(track.id, currentCount + 1);
            }
            visited.add(key);

            // ゴール判定: track.idがdestTrackIdならゴール（端点番号は問わない）
            if (String(track.id) === destTrackId) {
                let step = { trackId: track.id, endpoint: epIdx };
                if (track.isPoint && pointStates[track.id]) {
                    step.direction = pointStates[track.id];
                }
                results.push({
                    path: [...path, step],
                    pointStates: { ...pointStates }
                });
                console.log(`[DFS] ゴール到達: path=`, [...path, step].map(p => `${p.trackId}:${p.endpoint}${p.direction ? ':'+p.direction : ''}`));
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
                    const found = track.connections.find(([idx, _]) => idx === epIdx);
                    if (found) conn = found[1];
                }
            }
            if (conn) {
                let nextTrack = null;
                if (track.trackManager) {
                    nextTrack = track.trackManager.getTrack(conn.trackId);
                } else if (this.interlockingManager && this.interlockingManager.trackManager) {
                    nextTrack = this.interlockingManager.trackManager.getTrack(conn.trackId);
                }
                if (nextTrack) {
                    if (nextTrack.isPoint) {
                        if (nextTrack.type === 'double_cross') {
                            const pairs = [
                                { pair: [[0,1],[1,0],[2,3],[3,2]], dir: 'normal' },
                                { pair: [[0,3],[3,0],[1,2],[2,1]], dir: 'reverse' }
                            ];
                            for (const {pair, dir} of pairs) {
                                for (const [a, b] of pair) {
                                    if ((conn.endpointIndex === a && epIdx === b) || (conn.endpointIndex === b && epIdx === a)) {
                                        pointStates[nextTrack.id] = dir;
                                        let step = { trackId: track.id, endpoint: epIdx };
                                        if (track.isPoint && pointStates[track.id]) {
                                            step.direction = pointStates[track.id];
                                        }
                                        let nextStep = { trackId: nextTrack.id, endpoint: conn.endpointIndex, direction: dir };
                                        dfs(nextTrack, conn.endpointIndex, [...path, step, nextStep], pointStates);
                                        delete pointStates[nextTrack.id];
                                        break;
                                    }
                                }
                            }
                        } else if (nextTrack.type === 'double_slip_x') {
                            const pairs = [
                                { pair: [[0,1],[1,0],[2,3],[3,2]], dir: 'normal' },
                                { pair: [[0,3],[3,0],[1,2],[2,1]], dir: 'reverse' }
                            ];
                            for (const {pair, dir} of pairs) {
                                for (const [a, b] of pair) {
                                    if ((conn.endpointIndex === a && epIdx === b) || (conn.endpointIndex === b && epIdx === a)) {
                                        pointStates[nextTrack.id] = dir;
                                        let step = { trackId: track.id, endpoint: epIdx };
                                        if (track.isPoint && pointStates[track.id]) {
                                            step.direction = pointStates[track.id];
                                        }
                                        let nextStep = { trackId: nextTrack.id, endpoint: conn.endpointIndex, direction: dir };
                                        dfs(nextTrack, conn.endpointIndex, [...path, step, nextStep], pointStates);
                                        delete pointStates[nextTrack.id];
                                        break;
                                    }
                                }
                            }
                        } else {
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
                                    let step = { trackId: track.id, endpoint: epIdx };
                                    if (track.isPoint && pointStates[track.id]) {
                                        step.direction = pointStates[track.id];
                                    }
                                    dfs(nextTrack, nextEpIdx, [...path, step], pointStates);
                                }
                                delete pointStates[nextTrack.id];
                            });
                        }
                    } else {
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
                // ダブルクロス内端点間移動フラグ
                if (!dfs._doubleCrossMoved) dfs._doubleCrossMoved = {};
                if (track.type === 'double_cross' && typeof dfs._doubleCrossMoved[track.id] === 'undefined') {
                    dfs._doubleCrossMoved[track.id] = false;
                }
                for (let i = 0; i < track.endpoints.length; i++) {
                    if (i !== epIdx) {
                        // --- ダブルクロスで既にtrack内端点間移動済みなら、track内移動は一切許容しない ---
                        if (track.type === 'double_cross' && dfs._doubleCrossMoved[track.id]) {
                            // 既にtrack内端点間移動済みならスキップ
                            console.log(`[DFS:SKIP] ダブルクロス${track.id} 端点${epIdx}→端点${i} は既にtrack内移動済みのためスキップ`);
                            continue;
                        }
                        if (track.isPoint) {
                            if (track.type === 'point_left' || track.type === 'point_right') {
                                // 0↔1, 0↔2のみ
                                if (!((epIdx === 0 && (i === 1 || i === 2)) || (i === 0 && (epIdx === 1 || epIdx === 2)))) {
                                    console.log(`[DFS:SKIP] 分岐器${track.id} 端点${epIdx}→端点${i} の移動は許容されていないためスキップ`);
                                    continue;
                                } else {
                                    console.log(`[DFS:OK] 分岐器${track.id} 端点${epIdx}→端点${i} の移動を許容`);
                                }
                            } else if (track.type === 'double_cross') {
                                // ダブルクロスは許可ペアのみ
                                const allowedPairs = [
                                    [0,1],[1,0],[2,3],[3,2], // 直進
                                    [0,3],[3,0],[1,2],[2,1]  // 分岐
                                ];
                                const isAllowed = allowedPairs.some(([a,b]) => (epIdx === a && i === b));
                                if (!isAllowed) {
                                    console.log(`[DFS:SKIP] ダブルクロス${track.id} 端点${epIdx}→端点${i} の移動は許容されていないためスキップ`);
                                    continue;
                                } else {
                                    console.log(`[DFS:OK] ダブルクロス${track.id} 端点${epIdx}→端点${i} の移動を許容`);
                                    // ここでtrack内端点間移動を記録
                                    dfs._doubleCrossMoved[track.id] = true;
                                }
                            }
                        } else {
                            console.log(`[DFS:OK] 通常線路${track.id} 端点${epIdx}→端点${i} の移動を許容`);
                        }
                        let step = { trackId: track.id, endpoint: i };
                        if (track.isPoint && pointStates[track.id]) {
                            step.direction = pointStates[track.id];
                        }
                        console.log(`[DFS:CALL] track.id: ${track.id}, from epIdx: ${epIdx} → to epIdx: ${i}, path:`, [...path, step].map(p => `${p.trackId}:${p.endpoint}${p.direction ? ':'+p.direction : ''}`), 'pointStates:', JSON.stringify(pointStates));
                        dfs(track, i, [...path, step], pointStates);
                        // --- ダブルクロスtrack内端点間移動のフラグを戻す ---
                        if (track.type === 'double_cross' && dfs._doubleCrossMoved[track.id]) {
                            dfs._doubleCrossMoved[track.id] = false;
                        }
                    }
                }
            }
            visited.delete(key);
            // --- 修正: 通過回数の減算も同じtrack内の端点間移動は除外 ---
            if (path.length === 0 || path[path.length - 1].trackId !== track.id) {
                const count = trackPassCount.get(track.id);
                if (count === 1) {
                    trackPassCount.delete(track.id);
                } else {
                    trackPassCount.set(track.id, count - 1);
                }
            }
        };

        // 探索開始（着点の遠い方の端点のみを使用）
        dfs(startTrack, startEpIdx, [], {});

        // 重複する進路を除外（同じ経路で方向が異なるものは残す）
        const uniqueResults = results.filter((route, index) => {
            const reverseRoute = results.find((r, i) => {
                if (i === index) return false;
                if (r.path.length !== route.path.length) return false;
                for (let i = 0; i < route.path.length; i++) {
                    const forward = route.path[i];
                    const backward = r.path[route.path.length - 1 - i];
                    if (forward.trackId !== backward.trackId) return false;
                }
                return true;
            });
            if (reverseRoute) {
                return results.indexOf(reverseRoute) > index;
            }
            return true;
        });

        return uniqueResults;
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



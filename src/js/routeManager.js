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
    constructor() {
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
        this.clearRoutesBtn = document.getElementById('clearRoutesBtn');
        this.saveRouteBtn = document.getElementById('saveRouteBtn');
        this.loadRouteBtn = document.getElementById('loadRouteBtn');
        this.routeList = document.getElementById('route-list');
    }

    bindEvents() {
        this.autoRouteBtn.addEventListener('click', () => this.toggleAutoMode());
        this.manualRouteBtn.addEventListener('click', () => this.toggleManualMode());
        this.clearRoutesBtn.addEventListener('click', () => this.clearRoutes());
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
        this.trackGraph.clear();

        // ノードの作成
        trackElements.forEach(element => {
            if (!this.trackGraph.has(element.id)) {
                this.trackGraph.set(element.id, new TrackNode(element.id));
            }
        });

        // 接続関係の設定
        trackElements.forEach(element => {
            const sourceNode = this.trackGraph.get(element.id);
            
            // 直進方向の接続
            if (element.normalConnection) {
                const targetNode = this.trackGraph.get(element.normalConnection.id);
                if (targetNode) {
                    sourceNode.addConnection(targetNode, 1, 'normal');
                    targetNode.addConnection(sourceNode, 1, 'normal');
                }
            }

            // 分岐方向の接続
            if (element.reverseConnection) {
                const targetNode = this.trackGraph.get(element.reverseConnection.id);
                if (targetNode) {
                    sourceNode.addConnection(targetNode, 1.5, 'reverse'); // 分岐はコストを高めに設定
                    targetNode.addConnection(sourceNode, 1.5, 'reverse');
                }
            }
        });
    }

    // 経路の競合をチェック
    checkRouteConflict(route1, route2) {
        const route1Points = new Set(route1.points.map(p => p.id));
        const route2Points = new Set(route2.points.map(p => p.id));

        // 共通のポイントを探す
        for (const pointId of route1Points) {
            if (route2Points.has(pointId)) {
                const point1 = route1.points.find(p => p.id === pointId);
                const point2 = route2.points.find(p => p.id === pointId);
                
                // 同じポイントで異なる位置設定がある場合は競合
                if (point1.position !== point2.position) {
                    return true;
                }
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

    // 最適経路探索（コストマップ付き）
    findOptimalRoute(startId, endId, additionalCosts = new Map()) {
        if (!this.trackGraph.has(startId) || !this.trackGraph.has(endId)) {
            throw new Error('開始点または終点が見つかりません');
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

            currentNode.connections.forEach((connection, neighborId) => {
                if (!unvisited.has(neighborId)) return;

                // 基本コストと追加コストを考慮
                let connectionCost = connection.cost;
                if (additionalCosts.has(neighborId)) {
                    connectionCost += additionalCosts.get(neighborId);
                }

                const newDistance = distances.get(currentId) + connectionCost;
                if (newDistance < distances.get(neighborId)) {
                    distances.set(neighborId, newDistance);
                    previous.set(neighborId, {
                        id: currentId,
                        position: connection.position
                    });
                }
            });
        }

        // 経路の再構築
        const path = [];
        let current = endId;

        while (current !== null) {
            const prev = previous.get(current);
            if (!prev) {
                if (current !== startId) {
                    throw new Error('有効な経路が見つかりません');
                }
                break;
            }

            path.unshift({
                id: prev.id,
                position: prev.position
            });
            current = prev.id;
        }

        if (path.length > 0) {
            const lastConnection = this.trackGraph.get(path[path.length - 1].id)
                .connections.get(endId);
            path.push({
                id: endId,
                position: lastConnection ? lastConnection.position : 'normal'
            });
        }

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

            if (candidates.length > 0) {
                const validCandidates = candidates
                    .map(points => {
                        const route = new Route(
                            `${this.getLeverTypeName(this.selectedLever.type)} ${this.routes.size + 1}`,
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

                if (validCandidates.length > 0) {
                    const bestRoute = validCandidates[0];
                    this.addRoute(bestRoute);
                    this.updateRouteList();
                    this.highlightRoute(bestRoute.points);
                } else {
                    throw new Error('有効な進路が見つかりません');
                }
            }
        } catch (error) {
            console.error('進路生成エラー:', error);
            alert(`進路生成エラー: ${error.message}`);
        } finally {
            this.exitAutoMode();
        }
    }

    // 経路の視覚的表示
    highlightRoute(points) {
        // 既存のハイライトをクリア
        document.querySelectorAll('.route-highlight').forEach(el => {
            el.classList.remove('route-highlight');
        });

        // 新しい経路をハイライト
        points.forEach(point => {
            const element = document.querySelector(`[data-track-id="${point.id}"]`);
            if (element) {
                element.classList.add('route-highlight');
            }
        });
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
                    <div>テコ: ${this.getLeverTypeName(route.lever.type)}</div>
                    <div>着点: 着点ボタン ${route.destination.id}</div>
                    <div class="route-points">
                        ${route.points.map(p => `
                            <div class="route-point">
                                <span>ポイント: ${p.id}</span>
                                <span>位置: ${p.position === 'normal' ? '直進' : '分岐'}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
            
            this.routeList.appendChild(routeElement);
        });
    }

    activateRoute(routeId) {
        const route = this.routes.get(routeId);
        if (route) {
            if (route.isActive) {
                route.deactivate();
                this.activeRoutes.delete(route);
            } else {
                // 競合チェック
                let canActivate = true;
                this.activeRoutes.forEach(activeRoute => {
                    if (this.checkRouteConflict(route, activeRoute)) {
                        canActivate = false;
                        alert('この進路は既存の進路と競合するため設定できません');
                        return;
                    }
                });

                if (canActivate) {
                    route.activate();
                    this.activeRoutes.add(route);
                }
            }
            this.updateRouteList();
        }
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
        const steps = mode === 'auto' ? [
            '「自動生成」ボタンをクリックして自動生成モードを開始',
            'テコ（信号/入換/標識/開通）を選択',
            '着点ボタンを選択',
            '自動的に最適な進路が生成されます'
        ] : [
            '「手動生成」ボタンをクリックして手動生成モードを開始',
            'テコ（信号/入換/標識/開通）を選択',
            '進路に含めるポイントを順番にクリック（右クリックで位置切替）',
            '着点ボタンをクリックして確定'
        ];

        this.guidanceSteps.innerHTML = steps.map((step, index) => `
            <li class="guidance-step">
                <div class="step-number">${index + 1}</div>
                <div class="step-content">${step}</div>
            </li>
        `).join('');

        this.guidance.classList.add('active');
    }

    hideGuidance() {
        this.guidance.classList.remove('active');
    }

    updateModeIndicator(mode) {
        if (mode === 'none') {
            this.modeIndicator.classList.remove('active', 'auto', 'manual');
        } else {
            this.modeIndicator.classList.add('active', mode);
            this.modeText.textContent = mode === 'auto' ? '自動生成モード' : '手動生成モード';
        }
    }
}

// グローバルインスタンスを作成
const routeManager = new RouteManager(); 
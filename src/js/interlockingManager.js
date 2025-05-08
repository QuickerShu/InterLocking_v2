/**
 * 連動要素の管理クラス
 * 発点てこ、着点ボタン、線路絶縁の管理と操作を提供する
 */

// 必要なクラスはグローバル変数から参照

// 定数定義
const HIT_RADIUS = 20; // クリック判定半径
const HIGHLIGHT_RADIUS = 15; // ハイライト円半径

class InterlockingManager {
    constructor(canvas, interlockingSystem, trackManager) {
        this.canvas = canvas;
        this.interlockingSystem = interlockingSystem;
        this.trackManager = trackManager;
        
        // 各要素のコレクション
        this.collections = {
            lever: [],
            button: [],
            insulation: []
        };
        // 旧名互換
        Object.defineProperty(this, 'startLevers', {
            get: () => this.collections.lever,
            set: v => { this.collections.lever = v; }
        });
        Object.defineProperty(this, 'destinationButtons', {
            get: () => this.collections.button,
            set: v => { this.collections.button = v; }
        });
        Object.defineProperty(this, 'trackInsulations', {
            get: () => this.collections.insulation,
            set: v => { this.collections.insulation = v; }
        });
        
        // 要素の連番カウンター
        this.counters = {
            signal: 1,          // 信号てこ
            shunting_signal: 1, // 入換てこ
            shunting_marker: 1, // 標識てこ
            through_lever: 1,   // 開通てこ
            destButton: 1,      // 着点ボタン
            insulation: 1       // 線路絶縁
        };
        
        // 進路選択状態の管理
        this.routeSelectionState = {
            isSelectingRoute: false,
            selectedLever: null,
            selectableButtons: []
        };
        
        // 編集モード用の状態管理を追加
        this.editModeState = {
            selectedElement: null,
            isDragging: false,
            lastMouseX: 0,
            lastMouseY: 0,
            elementType: null // 'lever', 'button', 'insulation' のいずれか
        };
        
        // イベントリスナー設定
        this._setupEventListeners();

        // --- ここから自動追加処理 ---
        // （コンストラクタからは削除）
        // --- ここまで自動追加処理 ---
    }
    
    /**
     * イベントリスナーの設定
     * @private
     */
    _setupEventListeners() {
        if (this.canvas && this.canvas.trackCanvas) {
            this.canvas.trackCanvas.addEventListener('click', this._onCanvasClick.bind(this));
            this.canvas.trackCanvas.addEventListener('contextmenu', this._onContextMenu.bind(this));
        }
        if (this.interlockingSystem && this.interlockingSystem.onChange) {
            this.interlockingSystem.onChange((event, data) => {
                this._onInterlockingChange(event, data);
            });
        }
    }
    
    /**
     * 右クリックのハンドラ
     * @param {MouseEvent} event 
     * @private
     */
    _onContextMenu(event) {
        event.preventDefault();
        if (this.canvas.appMode === 'operation') {
            const { x, y } = this._getCanvasCoords(event);
            for (const lever of this.collections.lever) {
                if (lever.isClicked(x, y)) {
                    lever.onClick(this.interlockingSystem, event);
                    this.canvas.draw();
                    return;
                }
            }
        }
    }
    
    /**
     * キャンバスクリックのハンドラ
     * @param {MouseEvent} event 
     * @private
     */
    _onCanvasClick(event) {
        if (this.canvas.preventNextClickEvent) return;
        const { x, y } = this._getCanvasCoords(event);
        if (this.canvas.appMode === 'edit') {
            if (this.canvas.drawMode === 'delete') {
                this._handleDeleteModeClick(x, y);
                return;
            }
            if (this.canvas.drawMode === 'cursor') {
                this._handleSelectModeClick(x, y);
                return;
            }
        } else {
            if (this.routeSelectionState.isSelectingRoute) {
                for (const button of this.collections.button) {
                    if (button.isClicked(x, y)) {
                        const result = button.onClick(this.interlockingSystem);
                        if (result) {
                            this._resetRouteSelection();
                            this.canvas.draw();
                        }
                        return;
                    }
                }
            }
            for (const lever of this.collections.lever) {
                if (lever.isClicked(x, y)) {
                    const result = lever.onClick(this.interlockingSystem, event);
                    if (result === 'route-selection-started') {
                        this._startRouteSelection(lever);
                    } else if (result === 'route-release-requested') {
                        this._resetRouteSelection();
                    }
                    this.canvas.draw();
                    return;
                }
            }
            if (this.routeSelectionState.isSelectingRoute) {
                this._resetRouteSelection();
                this.canvas.draw();
            }
        }
    }
    
    /**
     * マウスイベントからキャンバス座標を取得
     * @param {MouseEvent} event
     * @returns {{x: number, y: number}}
     * @private
     */
    _getCanvasCoords(event) {
        const rect = this.canvas.trackCanvas.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left) / this.canvas.scale + this.canvas.offsetX,
            y: (event.clientY - rect.top) / this.canvas.scale + this.canvas.offsetY
        };
    }
    
    /**
     * 削除モード時のクリック処理
     * @param {number} x クリック位置X座標
     * @param {number} y クリック位置Y座標
     * @private
     */
    _handleDeleteModeClick(x, y) {
        // 連動要素（てこや着点ボタン、絶縁）の位置判定と削除
        const element = this._findInterlockingElementAtPosition(x, y);
        if (element) {
            if (element.type === 'lever') {
                this.removeStartLever(element.id);
            } else if (element.type === 'button') {
                this.removeDestinationButton(element.id);
            } else if (element.type === 'insulation') {
                this.removeTrackInsulation(element.id);
            }
            this.canvas.draw();
        }
    }
    
    /**
     * 選択モード時のクリック処理
     * @param {number} x クリック位置X座標
     * @param {number} y クリック位置Y座標
     * @private
     */
    _handleSelectModeClick(x, y) {
        // 連動要素の選択
        const element = this._findInterlockingElementAtPosition(x, y);
        
        if (element) {
            this.editModeState.selectedElement = element.element;
            this.editModeState.elementType = element.type;
            this.editModeState.isDragging = true;
            this.editModeState.lastMouseX = x;
            this.editModeState.lastMouseY = y;
            this.canvas.draw();
        } else {
            // 何も選択されなかった場合は選択解除
            this.editModeState.selectedElement = null;
            this.editModeState.elementType = null;
            this.canvas.draw();
        }
    }
    
    /**
     * マウスムーブイベントハンドラ
     * @param {MouseEvent} event 
     */
    handleMouseMove(event) {
        const rect = this.canvas.trackCanvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) / this.canvas.scale + this.canvas.offsetX;
        const y = (event.clientY - rect.top) / this.canvas.scale + this.canvas.offsetY;
        
        // 編集モードでドラッグ中の場合
        if (this.canvas.appMode === 'edit' && this.editModeState.isDragging && this.editModeState.selectedElement) {
            const element = this.editModeState.selectedElement;
            const dx = x - this.editModeState.lastMouseX;
            const dy = y - this.editModeState.lastMouseY;
            
            // 位置を更新
            element.x += dx;
            element.y += dy;
            
            // スナップ処理
            const snappedPos = this.canvas.snapToGrid({ x: element.x, y: element.y });
            element.x = snappedPos.x;
            element.y = snappedPos.y;
            
            // 最後のマウス位置を更新
            this.editModeState.lastMouseX = x;
            this.editModeState.lastMouseY = y;
            
            this.canvas.draw();
        }
    }
    
    /**
     * マウスアップイベントハンドラ
     * @param {MouseEvent} event 
     */
    handleMouseUp(event) {
        if (this.editModeState.isDragging) {
            this.editModeState.isDragging = false;
            if (this.editModeState.selectedElement) {
                // --- trackId自動設定を削除 ---
                //const element = this.editModeState.selectedElement;
                //if (window.app) {
                //    const nearestTrackId = window.app.getNearestTrackId(element.position);
                //    if (nearestTrackId) {
                //        element.trackId = nearestTrackId;
                //        if (element.type === 'destButton' && Array.isArray(this.destinationButtons)) {
                //            const btn = this.destinationButtons.find(b => b.id === element.id);
                //            if (btn) btn.trackId = nearestTrackId;
                //        }
                //    }
                //}
            }
            this.editModeState.selectedElement = null;
            this.editModeState.elementType = null;
            this.canvas.draw();
        } else {
            this.editModeState.isDragging = false;
            this.editModeState.selectedElement = null;
            this.editModeState.elementType = null;
            this.canvas.draw();
        }
    }
    
    /**
     * 指定した位置にある連動要素を見つける
     * @param {number} x X座標
     * @param {number} y Y座標
     * @returns {Object|null} 見つかった要素の情報
     * @private
     */
    _findInterlockingElementAtPosition(x, y) {
        // 発点てこをチェック
        for (const lever of this.collections.lever) {
            const dx = x - lever.x;
            const dy = y - lever.y;
            if (Math.sqrt(dx * dx + dy * dy) <= HIT_RADIUS) {
                return { type: 'lever', element: lever, id: lever.id };
            }
        }
        // 着点ボタンをチェック
        for (const button of this.collections.button) {
            const dx = x - button.x;
            const dy = y - button.y;
            if (Math.sqrt(dx * dx + dy * dy) <= HIT_RADIUS) {
                return { type: 'button', element: button, id: button.id };
            }
        }
        // 線路絶縁をチェック
        for (const insulation of this.collections.insulation) {
            const dx = x - insulation.x;
            const dy = y - insulation.y;
            if (Math.sqrt(dx * dx + dy * dy) <= HIT_RADIUS) {
                return { type: 'insulation', element: insulation, id: insulation.id };
            }
        }
        return null;
    }
    
    /**
     * 連動状態変更のハンドラ
     * @param {string} event イベント名
     * @param {Object} data イベントデータ
     * @private
     */
    _onInterlockingChange(event, data) {
        switch (event) {
            case 'route-locked':
                // 進路開通時の処理
                this._handleRouteLocked(data.routeId);
                break;
                
            case 'route-released':
                // 進路解除時の処理
                this._handleRouteReleased(data.routeId);
                break;
                
            case 'track-occupancy-changed':
                // 軌道回路占有状態変更時の処理
                this._handleTrackOccupancyChanged(data.trackId, data.isOccupied);
                break;
        }
        
        // 画面の再描画をリクエスト
        this.canvas.draw();
    }
    
    /**
     * 進路開通時の処理
     * @param {string} routeId 開通した進路ID
     * @private
     */
    _handleRouteLocked(routeId) {
        // 進路に関連する発点てこと着点ボタンを設定
        const route = this.interlockingSystem.getRoute(routeId);
        if (!route) return;
        
        // 発点てこの進路開通状態を設定
        const startLever = this.startLevers.find(lever => 
            lever.routes.some(r => r.id === routeId)
        );
        
        if (startLever) {
            startLever.setActive(true);
        }
        
        // 着点ボタンの進路開通状態を設定
        const destButton = this.destinationButtons.find(button => 
            button.routes.some(r => r.id === routeId)
        );
        
        if (destButton) {
            destButton.setState(BUTTON_STATES.ACTIVE);
        }
    }
    
    /**
     * 進路解除時の処理
     * @param {string} routeId 解除された進路ID
     * @private
     */
    _handleRouteReleased(routeId) {
        // 進路に関連する発点てこと着点ボタンの状態をリセット
        const startLever = this.startLevers.find(lever => 
            lever.routes.some(r => r.id === routeId)
        );
        
        if (startLever) {
            startLever.state = LEVER_STATES.NEUTRAL;
            startLever.setActive(false);
        }
        
        const destButton = this.destinationButtons.find(button => 
            button.routes.some(r => r.id === routeId)
        );
        
        if (destButton) {
            destButton.setState(BUTTON_STATES.NORMAL);
        }
    }
    
    /**
     * 軌道回路占有状態変更時の処理
     * @param {string} trackId 軌道回路ID
     * @param {boolean} isOccupied 占有状態
     * @private
     */
    _handleTrackOccupancyChanged(trackId, isOccupied) {
        // 将来的な実装
    }
    
    /**
     * 進路選択の開始
     * @param {StartLever} lever 選択された発点てこ
     * @private
     */
    _startRouteSelection(lever) {
        // 選択状態をリセット
        this._resetRouteSelection();
        
        // 進路選択状態を設定
        this.routeSelectionState.isSelectingRoute = true;
        this.routeSelectionState.selectedLever = lever;
        
        // 選択可能な着点ボタンを特定
        const selectableButtons = this._getSelectableButtonsForLever(lever);
        this.routeSelectionState.selectableButtons = selectableButtons;
        
        // 選択可能なボタンの状態を更新
        selectableButtons.forEach(button => {
            button.setState(BUTTON_STATES.SELECTABLE);
        });
    }
    
    /**
     * 進路選択状態のリセット
     * @private
     */
    _resetRouteSelection() {
        if (!this.routeSelectionState.isSelectingRoute) {
            return;
        }
        
        // 選択状態をリセット
        this.routeSelectionState.isSelectingRoute = false;
        
        // 選択可能だったボタンの状態をリセット
        this.routeSelectionState.selectableButtons.forEach(button => {
            // 進路が開通中でない場合のみ状態をリセット
            const isActive = button.state === BUTTON_STATES.ACTIVE;
            if (!isActive) {
                button.setState(BUTTON_STATES.NORMAL);
            }
        });
        
        // selectedLeverがnullでなく、ルート選択がキャンセルされた場合
        if (this.routeSelectionState.selectedLever) {
            const lever = this.routeSelectionState.selectedLever;
            
            // レバーがアクティブな状態でない場合、ニュートラル状態にリセット
            if (!lever.animation.active && lever.state !== LEVER_STATES.NEUTRAL) {
                lever.state = LEVER_STATES.NEUTRAL;
                lever.selected = false;
            }
        }
        
        this.routeSelectionState.selectedLever = null;
        this.routeSelectionState.selectableButtons = [];
    }
    
    /**
     * 発点てこに対応する選択可能な着点ボタンを取得
     * @param {StartLever} lever 発点てこ
     * @returns {Array<DestinationButton>} 選択可能な着点ボタン
     * @private
     */
    _getSelectableButtonsForLever(lever) {
        const selectableButtons = [];
        
        // てこに関連付けられた進路から、対応する着点ボタンを特定
        for (const route of lever.routes) {
            const button = this.destinationButtons.find(btn => 
                btn.routes.some(r => r.id === route.id)
            );
            
            if (button && !selectableButtons.includes(button)) {
                selectableButtons.push(button);
            }
        }
        
        return selectableButtons;
    }
    
    /**
     * 要素の削除
     * @param {string} id 削除する要素のID
     * @param {string} type 要素の種類 ('lever', 'button', 'insulation')
     * @returns {boolean} 削除が成功したかどうか
     */
    removeElement(id, type) {
        return this._removeElement(type, id);
    }
    
    /**
     * 要素の描画
     * @param {CanvasRenderingContext2D} ctx キャンバスコンテキスト
     */
    draw(ctx) {
        // 線路絶縁の描画
        this.collections.insulation.forEach(insulation => {
            insulation.draw(ctx);
        });
        
        // 着点ボタンの描画
        this.collections.button.forEach(button => {
            button.draw(ctx);
        });
        
        // 発点てこの描画
        this.collections.lever.forEach(lever => {
            lever.draw(ctx);
        });
        
        // 選択中の要素のハイライト
        if (this.editModeState.selectedElement) {
            this._drawSelectedElementHighlight(ctx);
        }
    }
    
    /**
     * 選択中の要素のハイライトを描画
     * @param {CanvasRenderingContext2D} ctx キャンバスコンテキスト
     * @private
     */
    _drawSelectedElementHighlight(ctx) {
        const element = this.editModeState.selectedElement;
        if (!element) return;
        ctx.save();
        ctx.strokeStyle = '#00FFFF';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(element.x, element.y, HIGHLIGHT_RADIUS, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
    
    /**
     * 要素データをエクスポート
     * @returns {Object} エクスポートされたデータ
     */
    exportData() {
        return {
            startLevers: this.collections.lever.map(lever => ({
                id: lever.id,
                type: lever.type,
                position: { x: lever.x, y: lever.y },
                trackId: lever.trackId,
                routes: lever.routes?.map(route => route.id) || []
            })),
            destinationButtons: this.collections.button.map(button => ({
                id: button.id,
                position: { x: button.x, y: button.y },
                trackId: button.trackId,
                routes: button.routes?.map(route => route.id) || []
            })),
            trackInsulations: this.collections.insulation.map(insulation => ({
                id: insulation.id,
                position: { ...insulation.position },
                type: insulation.type,
                direction: insulation.direction,
                trackSegments: [...(insulation.trackSegments || [])]
            }))
        };
    }
    
    /**
     * 要素データをインポート
     * @param {Object} data インポートするデータ
     */
    importData(data) {
        // 既存の要素をクリア
        this.collections.lever = [];
        this.collections.button = [];
        this.collections.insulation = [];
        // インポート
        if (data.trackInsulations && Array.isArray(data.trackInsulations)) {
            data.trackInsulations.forEach(item => {
                const insulation = new TrackInsulation(
                    item.id,
                    item.position,
                    item.type,
                    item.direction
                );
                if (item.trackSegments && Array.isArray(item.trackSegments)) {
                    insulation.trackSegments = [...item.trackSegments];
                }
                this.collections.insulation.push(insulation);
            });
        }
        if (data.destinationButtons && Array.isArray(data.destinationButtons)) {
            data.destinationButtons.forEach(item => {
                const button = new DestinationButton(
                    item.id,
                    item.position,
                    item.trackId
                );
                this.collections.button.push(button);
            });
        }
        if (data.startLevers && Array.isArray(data.startLevers)) {
            data.startLevers.forEach(item => {
                const lever = new StartLever(
                    item.id,
                    item.type,
                    item.position.x,
                    item.position.y,
                    item.trackId
                );
                this.collections.lever.push(lever);
            });
        }
        // 進路参照の設定
        if (this.interlockingSystem) {
            if (data.startLevers) {
                data.startLevers.forEach((item, index) => {
                    if (item.routes && Array.isArray(item.routes)) {
                        item.routes.forEach(routeId => {
                            const route = this.interlockingSystem.getRoute(routeId);
                            if (route && this.collections.lever[index]) {
                                this.collections.lever[index].addRoute(route);
                            }
                        });
                    }
                });
            }
            if (data.destinationButtons) {
                data.destinationButtons.forEach((item, index) => {
                    if (item.routes && Array.isArray(item.routes)) {
                        item.routes.forEach(routeId => {
                            const route = this.interlockingSystem.getRoute(routeId);
                            if (route && this.collections.button[index]) {
                                this.collections.button[index].addRoute(route);
                            }
                        });
                    }
                });
            }
        }
        this.canvas.draw();
    }
    
    /**
     * 発点てこを削除
     * @param {string} id 削除する発点てこのID
     */
    removeStartLever(id) {
        if (this._removeElement('lever', id)) {
            if (this.editModeState.selectedElement && this.editModeState.selectedElement.id === id) {
                this.editModeState.selectedElement = null;
                this.editModeState.elementType = null;
            }
            this.canvas.setStatusInfo(`発点てこ ${id} を削除しました`);
        }
    }
    
    /**
     * 着点ボタンを削除
     * @param {string} id 削除する着点ボタンのID
     */
    removeDestinationButton(id) {
        if (this._removeElement('button', id)) {
            if (this.editModeState.selectedElement && this.editModeState.selectedElement.id === id) {
                this.editModeState.selectedElement = null;
                this.editModeState.elementType = null;
            }
            this.canvas.setStatusInfo(`着点ボタン ${id} を削除しました`);
        }
    }
    
    /**
     * 線路絶縁を削除
     * @param {string} id 削除する線路絶縁のID
     */
    removeTrackInsulation(id) {
        if (this._removeElement('insulation', id)) {
            if (this.editModeState.selectedElement && this.editModeState.selectedElement.id === id) {
                this.editModeState.selectedElement = null;
                this.editModeState.elementType = null;
            }
            this.canvas.setStatusInfo(`線路絶縁 ${id} を削除しました`);
        }
    }

    /**
     * startLevers/destinationButtonsが空の場合にデフォルトを追加
     */
    ensureDefaultLeversAndButtons() {
        if (!this.startLevers || this.startLevers.length === 0) {
            this.startLevers = [
                new StartLever(
                    "signalLever_auto",
                    "signal",
                    140,
                    420,
                    1
                )
            ];
        }
        if (!this.destinationButtons || this.destinationButtons.length === 0) {
            this.destinationButtons = [
                new DestinationButton(
                    "destButton_auto",
                    { x: 600, y: 220 },
                    3
                )
            ];
        }
    }

    // 要素タイプに応じた次の連番を取得
    getNextNumber(type) {
        if (this.counters.hasOwnProperty(type)) {
            const num = this.counters[type];
            this.counters[type]++;
            return num;
        }
        return 1;
    }

    // 連番をリセット（必要に応じて）
    resetCounters() {
        Object.keys(this.counters).forEach(key => {
            this.counters[key] = 1;
        });
    }

    // 既存の要素から連番を再計算
    recalculateCounters() {
        this.resetCounters();
        
        // 発点てこの連番を更新
        this.collections.lever.forEach(lever => {
            const num = parseInt(lever.name.match(/\d+$/)?.[0] || '0');
            if (num >= this.counters[lever.type]) {
                this.counters[lever.type] = num + 1;
            }
        });

        // 着点ボタンの連番を更新
        this.collections.button.forEach(button => {
            const num = parseInt(button.name.match(/\d+$/)?.[0] || '0');
            if (num >= this.counters.destButton) {
                this.counters.destButton = num + 1;
            }
        });

        // 線路絶縁の連番を更新
        this.collections.insulation.forEach(insulation => {
            const num = parseInt(insulation.name.match(/\d+$/)?.[0] || '0');
            if (num >= this.counters.insulation) {
                this.counters.insulation = num + 1;
            }
        });
    }

    /**
     * 要素追加の共通化
     * @param {string} type
     * @param {object} options
     * @returns {object} 追加された要素
     */
    addElement(type, options) {
        let element;
        switch (type) {
            case 'lever':
                element = this._createStartLever(options);
                break;
            case 'button':
                element = this._createDestinationButton(options);
                break;
            case 'insulation':
                element = this._createTrackInsulation(options);
                break;
            default:
                throw new Error('Unknown element type');
        }
        this._addElement(type, element);
        return element;
    }

    /**
     * 発点てこ生成
     * @private
     */
    _createStartLever(options) {
        const type = options.type;
        if (!this.counters[type]) this.counters[type] = 1;
        let id = options.id;
        if (typeof id === 'string' && id.startsWith('temp_')) {
            id = `${type}Lever_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        }
        const existing = this.collections.lever.find(l => l.id === id);
        if (existing) {
            if (options.trackId !== undefined) existing.trackId = options.trackId;
            if (options.endpointIndex !== undefined) existing.endpointIndex = options.endpointIndex;
            return existing;
        }
        const name = `${window.app.getLeverTypeName(type)}${this.counters[type]}`;
        const lever = new StartLever(id, type, options.x, options.y, options.trackId, this.counters[type]);
        lever.name = name;
        lever.endpointIndex = options.endpointIndex;
        this.counters[type]++;
        return lever;
    }

    /**
     * 着点ボタン生成
     * @private
     */
    _createDestinationButton(options) {
        if (!this.counters.destButton) this.counters.destButton = 1;
        let id = options.id;
        if (typeof id === 'string' && id.startsWith('temp_')) {
            id = `destButton_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        }
        const existing = this.collections.button.find(b => b.id === id);
        if (existing) {
            if (options.trackId !== undefined) existing.trackId = options.trackId;
            if (options.endpointIndex !== undefined) existing.endpointIndex = options.endpointIndex;
            return existing;
        }
        const name = `着点ボタン${this.counters.destButton}`;
        const button = new DestinationButton(id, {x: options.x, y: options.y}, options.trackId, this.counters.destButton);
        button.name = name;
        button.endpointIndex = options.endpointIndex;
        this.counters.destButton++;
        return button;
    }

    /**
     * 線路絶縁生成
     * @private
     */
    _createTrackInsulation(options) {
        if (!this.counters.insulation) this.counters.insulation = 1;
        let id = options.id;
        if (typeof id === 'string' && id.startsWith('temp_')) {
            id = `insulation_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        }
        const existing = this.collections.insulation.find(i => i.id === id);
        if (existing) {
            return existing;
        }
        const name = `線路絶縁${this.counters.insulation}`;
        const insulation = new TrackInsulation(id, options.position, options.type, options.direction);
        insulation.name = name;
        this.counters.insulation++;
        return insulation;
    }

    // 共通コレクション操作
    _findElement(type, id) {
        return this.collections[type]?.find(e => e.id === id) || null;
    }
    _addElement(type, element) {
        if (!this.collections[type]) this.collections[type] = [];
        this.collections[type].push(element);
    }
    _removeElement(type, id) {
        const col = this.collections[type];
        if (!col) return false;
        const idx = col.findIndex(e => e.id === id);
        if (idx !== -1) {
            col.splice(idx, 1);
            this.canvas.draw();
            return true;
        }
        return false;
    }

    /**
     * 既存API互換ラッパー: 発点てこ追加
     * @param {object} options
     * @returns {object}
     */
    addStartLever(options) {
        return this.addElement('lever', options);
    }
    /**
     * 既存API互換ラッパー: 着点ボタン追加
     * @param {object} options
     * @returns {object}
     */
    addDestinationButton(options) {
        return this.addElement('button', options);
    }
    /**
     * 既存API互換ラッパー: 線路絶縁追加
     * @param {object} options
     * @returns {object}
     */
    addTrackInsulation(options) {
        return this.addElement('insulation', options);
    }
}

// グローバル変数として公開
window.InterlockingManager = InterlockingManager;
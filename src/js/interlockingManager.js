/**
 * 連動要素の管理クラス
 * 発点てこ、着点ボタン、線路絶縁の管理と操作を提供する
 */

// 必要なクラスはグローバル変数から参照

class InterlockingManager {
    constructor(canvas, interlockingSystem) {
        this.canvas = canvas;
        this.interlockingSystem = interlockingSystem;
        
        // 各要素のコレクション
        this.startLevers = [];
        this.destinationButtons = [];
        this.trackInsulations = [];
        
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
    }
    
    /**
     * イベントリスナーの設定
     * @private
     */
    _setupEventListeners() {
        // キャンバスクリックイベント
        // trackCanvasに対してイベントリスナーを追加
        if (this.canvas && this.canvas.trackCanvas) {
            this.canvas.trackCanvas.addEventListener('click', this._handleCanvasClick.bind(this));
            // 右クリックイベントハンドラを追加
            this.canvas.trackCanvas.addEventListener('contextmenu', this._handleContextMenu.bind(this));
        }
        
        // 進路状態変更時のリスナー
        if (this.interlockingSystem && this.interlockingSystem.onChange) {
            this.interlockingSystem.onChange((event, data) => {
                this._handleInterlockingChange(event, data);
            });
        }
    }
    
    /**
     * 右クリックのハンドラ
     * @param {MouseEvent} event 
     * @private
     */
    _handleContextMenu(event) {
        // コンテキストメニューを表示しないよう防止
        event.preventDefault();
        
        // 操作モードの場合のみ処理
        if (this.canvas.appMode === 'operation') {
            const rect = this.canvas.trackCanvas.getBoundingClientRect();
            const x = (event.clientX - rect.left) / this.canvas.scale + this.canvas.offsetX;
            const y = (event.clientY - rect.top) / this.canvas.scale + this.canvas.offsetY;
            
            // てこのクリック判定
            for (const lever of this.startLevers) {
                if (lever.isClicked(x, y)) {
                    lever.onClick(this.interlockingSystem, event);
                    this.canvas.draw();
                    return;
                }
            }
            
            // ポイントをクリックした場合も追加できますが、この実装は保留します
        }
    }
    
    /**
     * キャンバスクリックのハンドラ
     * @param {MouseEvent} event 
     * @private
     */
    _handleCanvasClick(event) {
        // Canvas側でクリックイベント防止フラグがセットされている場合は何もしない
        if (this.canvas.preventNextClickEvent) {
            return;
        }

        const rect = this.canvas.trackCanvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) / this.canvas.scale + this.canvas.offsetX;
        const y = (event.clientY - rect.top) / this.canvas.scale + this.canvas.offsetY;
        
        // アプリケーションモードによって処理を分岐
        if (this.canvas.appMode === 'edit') {
            // 編集モードの場合
            
            if (this.canvas.drawMode === 'delete') {
                // 削除モードの場合
                this._handleDeleteModeClick(x, y);
                return;
            }
            
            if (this.canvas.drawMode === 'cursor') {
                // 選択モードの場合
                this._handleSelectModeClick(x, y);
                return;
            }
        } else {
            // 操作モードの場合（既存の処理）
            // 着点ボタンのクリック判定
            if (this.routeSelectionState.isSelectingRoute) {
                for (const button of this.destinationButtons) {
                    if (button.isClicked(x, y)) {
                        const result = button.onClick(this.interlockingSystem);
                        if (result) {
                            // 進路が選択された場合は選択状態をリセット
                            this._resetRouteSelection();
                            this.canvas.draw();
                        }
                        return;
                    }
                }
            }
            
            // 発点てこのクリック判定
            for (const lever of this.startLevers) {
                if (lever.isClicked(x, y)) {
                    const result = lever.onClick(this.interlockingSystem, event);
                    if (result === 'route-selection-started') {
                        // 進路選択開始
                        this._startRouteSelection(lever);
                    } else if (result === 'route-release-requested') {
                        // 進路解除リクエスト
                        this._resetRouteSelection();
                    }
                    this.canvas.draw();
                    return;
                }
            }
            
            // 何もクリックされなかった場合は選択をリセット
            if (this.routeSelectionState.isSelectingRoute) {
                this._resetRouteSelection();
                this.canvas.draw();
            }
        }
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
        // ドラッグ終了
        if (this.editModeState.isDragging) {
            this.editModeState.isDragging = false;
            
            // ドラッグ終了時、必要に応じて線路IDを更新
            if (this.editModeState.selectedElement) {
                const element = this.editModeState.selectedElement;
                // 最も近い線路を見つけて関連付け
                if (window.app) {
                    const nearestTrackId = window.app.getNearestTrackId(element.position);
                    if (nearestTrackId) {
                        element.trackId = nearestTrackId;
                    }
                }
                
                // 新規配置直後の場合は選択状態を解除する
                // アプリケーション側から新規配置後のフラグをチェック
                if (window.app && window.app.canvas.preventNextClickEvent) {
                    // 選択状態を解除
                    this.editModeState.selectedElement = null;
                    this.editModeState.elementType = null;
                }
            }
            
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
        // 判定半径
        const hitRadius = 20;
        
        // 発点てこをチェック
        for (const lever of this.startLevers) {
            const dx = x - lever.x;
            const dy = y - lever.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance <= hitRadius) {
                return { type: 'lever', element: lever, id: lever.id };
            }
        }
        
        // 着点ボタンをチェック
        for (const button of this.destinationButtons) {
            const dx = x - button.x;
            const dy = y - button.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance <= hitRadius) {
                return { type: 'button', element: button, id: button.id };
            }
        }
        
        // 線路絶縁をチェック
        for (const insulation of this.trackInsulations) {
            const dx = x - insulation.x;
            const dy = y - insulation.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance <= hitRadius) {
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
    _handleInterlockingChange(event, data) {
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
     * 発点てこを追加
     * @param {Object} options てこのオプション
     * @returns {StartLever} 追加されたてこ
     */
    addStartLever(options) {
        const { id, type, x, y, trackId } = options;
        
        // 既存のIDチェック
        if (this.startLevers.some(lever => lever.id === id)) {
            throw new Error(`ID ${id} の発点てこは既に存在します`);
        }
        
        // てこの作成
        const lever = new StartLever(id, type, x, y, trackId);
        
        // コレクションに追加
        this.startLevers.push(lever);
        
        // 画面の再描画をリクエスト
        this.canvas.draw();
        
        return lever;
    }
    
    /**
     * 着点ボタンを追加
     * @param {Object} options ボタンのオプション
     * @returns {DestinationButton} 追加されたボタン
     */
    addDestinationButton(options) {
        const { id, position, trackId } = options;
        
        // 既存のIDチェック
        if (this.destinationButtons.some(button => button.id === id)) {
            throw new Error(`ID ${id} の着点ボタンは既に存在します`);
        }
        
        // ボタンの作成
        const button = new DestinationButton(id, position, trackId);
        
        // コレクションに追加
        this.destinationButtons.push(button);
        
        // 画面の再描画をリクエスト
        this.canvas.draw();
        
        return button;
    }
    
    /**
     * 線路絶縁を追加
     * @param {Object} options 線路絶縁のオプション
     * @returns {TrackInsulation} 追加された線路絶縁
     */
    addTrackInsulation(options) {
        const { id, position, type, direction } = options;
        
        // 既存のIDチェック
        if (this.trackInsulations.some(insulation => insulation.id === id)) {
            throw new Error(`ID ${id} の線路絶縁は既に存在します`);
        }
        
        // 線路絶縁の作成
        const insulation = new TrackInsulation(id, position, type, direction);
        
        // コレクションに追加
        this.trackInsulations.push(insulation);
        
        // 画面の再描画をリクエスト
        this.canvas.draw();
        
        return insulation;
    }
    
    /**
     * 要素の削除
     * @param {string} id 削除する要素のID
     * @param {string} type 要素の種類 ('lever', 'button', 'insulation')
     * @returns {boolean} 削除が成功したかどうか
     */
    removeElement(id, type) {
        let index = -1;
        let collection = null;
        
        switch (type) {
            case 'lever':
                collection = this.startLevers;
                index = collection.findIndex(item => item.id === id);
                break;
                
            case 'button':
                collection = this.destinationButtons;
                index = collection.findIndex(item => item.id === id);
                break;
                
            case 'insulation':
                collection = this.trackInsulations;
                index = collection.findIndex(item => item.id === id);
                break;
                
            default:
                return false;
        }
        
        if (index === -1) {
            return false;
        }
        
        // 要素の削除
        collection.splice(index, 1);
        
        // 画面の再描画をリクエスト
        this.canvas.draw();
        
        return true;
    }
    
    /**
     * 要素の描画
     * @param {CanvasRenderingContext2D} ctx キャンバスコンテキスト
     */
    draw(ctx) {
        // 線路絶縁の描画
        this.trackInsulations.forEach(insulation => {
            insulation.draw(ctx);
        });
        
        // 着点ボタンの描画
        this.destinationButtons.forEach(button => {
            button.draw(ctx);
        });
        
        // 発点てこの描画
        this.startLevers.forEach(lever => {
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
        ctx.arc(element.x, element.y, 15, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
    
    /**
     * 要素データをエクスポート
     * @returns {Object} エクスポートされたデータ
     */
    exportData() {
        return {
            startLevers: this.startLevers.map(lever => ({
                id: lever.id,
                type: lever.type,
                position: { ...lever.position },
                trackId: lever.trackId,
                routes: lever.routes.map(route => route.id)
            })),
            
            destinationButtons: this.destinationButtons.map(button => ({
                id: button.id,
                position: { ...button.position },
                trackId: button.trackId,
                routes: button.routes.map(route => route.id)
            })),
            
            trackInsulations: this.trackInsulations.map(insulation => ({
                id: insulation.id,
                position: { ...insulation.position },
                type: insulation.type,
                direction: insulation.direction,
                trackSegments: [...insulation.trackSegments]
            }))
        };
    }
    
    /**
     * 要素データをインポート
     * @param {Object} data インポートするデータ
     */
    importData(data) {
        // 既存の要素をクリア
        this.startLevers = [];
        this.destinationButtons = [];
        this.trackInsulations = [];
        
        // 要素のインポート
        if (data.trackInsulations && Array.isArray(data.trackInsulations)) {
            data.trackInsulations.forEach(item => {
                const insulation = new TrackInsulation(
                    item.id,
                    item.position,
                    item.type,
                    item.direction
                );
                
                // トラックセグメントの設定
                if (item.trackSegments && Array.isArray(item.trackSegments)) {
                    insulation.trackSegments = [...item.trackSegments];
                }
                
                this.trackInsulations.push(insulation);
            });
        }
        
        // ボタンのインポート
        if (data.destinationButtons && Array.isArray(data.destinationButtons)) {
            data.destinationButtons.forEach(item => {
                const button = new DestinationButton(
                    item.id,
                    item.position,
                    item.trackId
                );
                
                this.destinationButtons.push(button);
            });
        }
        
        // レバーのインポート
        if (data.startLevers && Array.isArray(data.startLevers)) {
            data.startLevers.forEach(item => {
                const lever = new StartLever(
                    item.id,
                    item.type,
                    item.position,
                    item.trackId
                );
                
                this.startLevers.push(lever);
            });
        }
        
        // 進路参照の設定
        if (this.interlockingSystem) {
            // レバーの進路設定
            if (data.startLevers) {
                data.startLevers.forEach((item, index) => {
                    if (item.routes && Array.isArray(item.routes)) {
                        item.routes.forEach(routeId => {
                            const route = this.interlockingSystem.getRoute(routeId);
                            if (route && this.startLevers[index]) {
                                this.startLevers[index].addRoute(route);
                            }
                        });
                    }
                });
            }
            
            // ボタンの進路設定
            if (data.destinationButtons) {
                data.destinationButtons.forEach((item, index) => {
                    if (item.routes && Array.isArray(item.routes)) {
                        item.routes.forEach(routeId => {
                            const route = this.interlockingSystem.getRoute(routeId);
                            if (route && this.destinationButtons[index]) {
                                this.destinationButtons[index].addRoute(route);
                            }
                        });
                    }
                });
            }
        }
        
        // 画面の再描画をリクエスト
        this.canvas.draw();
    }
    
    /**
     * 発点てこを削除
     * @param {string} id 削除する発点てこのID
     */
    removeStartLever(id) {
        const index = this.startLevers.findIndex(lever => lever.id === id);
        if (index !== -1) {
            this.startLevers.splice(index, 1);
            
            // 選択状態も更新
            if (this.editModeState.selectedElement && this.editModeState.selectedElement.id === id) {
                this.editModeState.selectedElement = null;
                this.editModeState.elementType = null;
            }
            
            // ステータス表示を更新
            this.canvas.setStatusInfo(`発点てこ ${id} を削除しました`);
        }
    }
    
    /**
     * 着点ボタンを削除
     * @param {string} id 削除する着点ボタンのID
     */
    removeDestinationButton(id) {
        const index = this.destinationButtons.findIndex(button => button.id === id);
        if (index !== -1) {
            this.destinationButtons.splice(index, 1);
            
            // 選択状態も更新
            if (this.editModeState.selectedElement && this.editModeState.selectedElement.id === id) {
                this.editModeState.selectedElement = null;
                this.editModeState.elementType = null;
            }
            
            // ステータス表示を更新
            this.canvas.setStatusInfo(`着点ボタン ${id} を削除しました`);
        }
    }
    
    /**
     * 線路絶縁を削除
     * @param {string} id 削除する線路絶縁のID
     */
    removeTrackInsulation(id) {
        const index = this.trackInsulations.findIndex(insulation => insulation.id === id);
        if (index !== -1) {
            this.trackInsulations.splice(index, 1);
            
            // 選択状態も更新
            if (this.editModeState.selectedElement && this.editModeState.selectedElement.id === id) {
                this.editModeState.selectedElement = null;
                this.editModeState.elementType = null;
            }
            
            // ステータス表示を更新
            this.canvas.setStatusInfo(`線路絶縁 ${id} を削除しました`);
        }
    }
}

// グローバル変数として公開
window.InterlockingManager = InterlockingManager;
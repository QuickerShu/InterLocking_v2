/**
 * アプリケーションのメインクラス
 */
class App {
    constructor(gridCanvasId, trackCanvasId) {
        this.trackManager = new TrackManager();
        this.canvas = new Canvas(gridCanvasId, trackCanvasId, this.trackManager);
        this.toolbar = document.getElementById('toolbar');
        
        // アプリケーションモード
        this.appMode = 'operation'; // 'edit'または'operation'
        
        // DSAir接続状態
        this.isDSAirConnected = false;
        
        // プレビュー表示用の変数を追加
        this.currentPreviewElement = null;
        
        // 連動装置の初期化
        // 連動装置Interlockingが実装されるまでは仮のオブジェクトを使用
        this.interlocking = {
            // ダミーメソッド
            onStartLeverSelected: function(lever) { return 'route-selection-started'; },
            requestRouteRelease: function(lever, prevState) { return 'route-release-requested'; },
            onDestinationButtonSelected: function(button) { return true; },
            getRoute: function(routeId) { return null; }
        };
        this.interlockingManager = new InterlockingManager(this.canvas, this.interlocking, this.trackManager);
        window.routeManager = new RouteManager(this.interlockingManager);
        
        // サイドパネルの初期化
        this.sidePanel = document.getElementById('side-panel');
        this.pointsContainer = document.getElementById('points-container');
        this.selectedProperties = document.getElementById('selected-properties');
        this.isPanelVisible = true;
        
        // ステータスバーの初期化
        this.connectionStatusText = document.getElementById('connection-status-text');
        this.connectionStatusDot = document.querySelector('.status-dot');
        this.statusInfo = document.getElementById('status-info');
        
        // トラックマネージャーにリスナーとして自身を登録
        this.trackManager.addListener(this);
        
        // UIの初期設定
        this.setupToolbar();
        this.setupKeyboardShortcuts();
        this.setupEventListeners();
        
        // 初期状態の設定
        this.updatePointsList();
        this.updateConnectionStatus();
        
        // 初期モードの視覚的表示を設定
        this.updateAppModeButtons();
        this.updateDrawToolButtons();
        this.setMode('cursor'); // 初期描画モードを選択モードに設定
        
        // トグルボタンの初期位置を設定
        const togglePanelBtn = document.getElementById('togglePanelBtn');
        if (togglePanelBtn) {
            togglePanelBtn.style.right = this.isPanelVisible ? '316px' : '16px';
        }
        
        // グローバル変数としてアプリケーションを公開
        window.app = this;
        
        // 選択対象（'track' or 'element'）
        this.selectionTarget = 'track';

        // 表示設定トグルボタンの状態を初期化
        this.updateToggleButtonStates();
    }

    // ツールバーの設定
    setupToolbar() {
        // モード切り替えボタン
        document.getElementById('editModeBtn').addEventListener('click', () => {
            // 現在配置モードが進行中であればキャンセル
            if (this.isPlacingElement) {
                this.cancelElementPlacement();
            }
            this.setAppMode('edit');
        });
        
        document.getElementById('operationModeBtn').addEventListener('click', () => {
            // 現在配置モードが進行中であればキャンセル
            if (this.isPlacingElement) {
                this.cancelElementPlacement();
            }
            this.setAppMode('operation');
        });
        
        // モード選択ボタン
        document.getElementById('cursorBtn').addEventListener('click', () => {
            // 現在配置モードが進行中であればキャンセル
            if (this.isPlacingElement) {
                this.cancelElementPlacement();
            }
            this.setMode('cursor');
        });
        
        document.getElementById('connectBtn').addEventListener('click', () => {
            // 現在配置モードが進行中であればキャンセル
            if (this.isPlacingElement) {
                this.cancelElementPlacement();
            }
            this.setMode('connect');
        });
        
        document.getElementById('deleteBtn').addEventListener('click', () => {
            // 現在配置モードが進行中であればキャンセル
            if (this.isPlacingElement) {
                this.cancelElementPlacement();
            }
            this.setMode('delete');
        });

        // 配置モードボタンを追加
        const placeBtn = document.createElement('button');
        placeBtn.id = 'placeBtn';
        placeBtn.textContent = '配置';
        placeBtn.title = 'パーツを配置するモード';
        
        // cursorBtnの後に挿入
        const cursorBtn = document.getElementById('cursorBtn');
        if (cursorBtn && cursorBtn.parentNode) {
            cursorBtn.parentNode.insertBefore(placeBtn, cursorBtn.nextSibling);
        }

        placeBtn.addEventListener('click', () => {
            this.setMode('place');
        });
        
        // 表示設定ボタン
        document.getElementById('toggleGridBtn').addEventListener('click', () => {
            this.canvas.toggleGrid();
            document.getElementById('toggleGridBtn').classList.toggle('active');
        });
        
        document.getElementById('toggleEndpointsBtn').addEventListener('click', () => {
            this.canvas.toggleEndpoints();
            document.getElementById('toggleEndpointsBtn').classList.toggle('active');
        });
        
        document.getElementById('toggleConnectionsBtn').addEventListener('click', () => {
            this.canvas.toggleConnections();
            document.getElementById('toggleConnectionsBtn').classList.toggle('active');
        });
        
        document.getElementById('toggleLabelsBtn').addEventListener('click', () => {
            this.canvas.toggleConnectionLabels();
            document.getElementById('toggleLabelsBtn').classList.toggle('active');
        });
        
        // キャンバスサイズ変更ボタンを追加
        const visibilityBtn = document.getElementById('visibility');
        if (visibilityBtn) {
            const canvasSizeBtn = document.createElement('button');
            canvasSizeBtn.id = 'canvasSizeBtn';
            canvasSizeBtn.textContent = 'キャンバスサイズ';
            visibilityBtn.parentNode.insertBefore(canvasSizeBtn, visibilityBtn);
            
            canvasSizeBtn.addEventListener('click', () => {
                this.showCanvasSizeDialog();
            });
        }
        
        // 回転ボタン
        document.getElementById('rotateClockwiseBtn').addEventListener('click', () => {
            if (this.canvas.selectedTrack) {
                this.canvas.selectedTrack.rotate(90);
                this.canvas.draw();
            }
        });
        
        document.getElementById('rotateCounterBtn').addEventListener('click', () => {
            if (this.canvas.selectedTrack) {
                this.canvas.selectedTrack.rotate(-90);
                this.canvas.draw();
            }
        });
        
        // 線路パーツボタン
        // 直線ボタン
        document.getElementById('straight').addEventListener('click', () => {
            if (this.appMode !== 'edit' || this.drawMode !== 'place') {
                this.setStatusInfo('配置モードに切り替えてください。');
                return;
            }
            if (this.isPlacingElement) {
                this.cancelElementPlacement();
            }
            this.placingPartType = 'straight';
            this.updateTrackPartButtonState('straight');
            this.setStatusInfo('直線を描画します。最初の点をクリックしてください。');
        });
        // 左分岐ポイント
        document.getElementById('point-left').addEventListener('click', () => {
            if (this.appMode !== 'edit' || this.drawMode !== 'place') {
                this.setStatusInfo('配置モードに切り替えてください。');
                return;
            }
            if (this.isPlacingElement) {
                this.cancelElementPlacement();
            }
            this.placingPartType = 'point-left';
            this.updateTrackPartButtonState('point-left');
            this.setStatusInfo('左分岐を配置します。');
        });
        // 右分岐ポイント
        document.getElementById('point-right').addEventListener('click', () => {
            if (this.appMode !== 'edit' || this.drawMode !== 'place') {
                this.setStatusInfo('配置モードに切り替えてください。');
                return;
            }
            if (this.isPlacingElement) {
                this.cancelElementPlacement();
            }
            this.placingPartType = 'point-right';
            this.updateTrackPartButtonState('point-right');
            this.setStatusInfo('右分岐を配置します。');
        });
        // ダブルクロス
        document.getElementById('double-slip').addEventListener('click', () => {
            if (this.appMode !== 'edit' || this.drawMode !== 'place') {
                this.setStatusInfo('配置モードに切り替えてください。');
                return;
            }
            if (this.isPlacingElement) {
                this.cancelElementPlacement();
            }
            this.placingPartType = 'double-slip';
            this.updateTrackPartButtonState('double-slip');
            this.setStatusInfo('ダブルクロスを配置します。');
        });
        // ダブルスリップ
        document.getElementById('double-slipX').addEventListener('click', () => {
            if (this.appMode !== 'edit' || this.drawMode !== 'place') {
                this.setStatusInfo('配置モードに切り替えてください。');
                return;
            }
            if (this.isPlacingElement) {
                this.cancelElementPlacement();
            }
            this.placingPartType = 'double-slipX';
            this.updateTrackPartButtonState('double-slipX');
            this.setStatusInfo('ダブルスリップを配置します。');
        });
        // 交差
        document.getElementById('crossing').addEventListener('click', () => {
            if (this.appMode !== 'edit' || this.drawMode !== 'place') {
                this.setStatusInfo('配置モードに切り替えてください。');
                return;
            }
            if (this.isPlacingElement) {
                this.cancelElementPlacement();
            }
            this.placingPartType = 'crossing';
            this.updateTrackPartButtonState('crossing');
            this.setStatusInfo('交差を配置します。');
        });
        // エンド
        document.getElementById('end').addEventListener('click', () => {
            if (this.appMode !== 'edit' || this.drawMode !== 'place') {
                this.setStatusInfo('配置モードに切り替えてください。');
                return;
            }
            if (this.isPlacingElement) {
                this.cancelElementPlacement();
            }
            this.placingPartType = 'end';
            this.updateTrackPartButtonState('end');
            this.setStatusInfo('エンドを配置します。');
        });
        // 線路絶縁
        document.getElementById('straightInsulation').addEventListener('click', () => {
            if (this.appMode !== 'edit' || this.drawMode !== 'place') {
                this.setStatusInfo('配置モードに切り替えてください。');
                return;
            }
            if (this.isPlacingElement) {
                this.cancelElementPlacement();
            }
            this.placingPartType = 'straightInsulation';
            this.updateTrackPartButtonState('straightInsulation');
            this.setStatusInfo('直線絶縁を配置します。');
        });
        
        // テキストラベルボタンのイベントハンドラ
        document.getElementById('textLabel').addEventListener('click', () => {
            // 現在配置モードが進行中であればキャンセル
            if (this.appMode !== 'edit' || this.drawMode !== 'place') {
                this.setStatusInfo('配置モードに切り替えてください。');
                return;
            }
            this.placeTextLabel();
        });

        // 連動要素ボタンのイベントリスナーを設定
        document.getElementById('signalLeverBtn').addEventListener('click', () => {
            if (this.appMode !== 'edit' || this.drawMode !== 'place') {
                this.setStatusInfo('配置モードに切り替えてください。');
                return;
            }
            this.placeInterlockingElement('signalLever');
        });
        
        document.getElementById('shuntingLeverBtn').addEventListener('click', () => {
            if (this.appMode !== 'edit' || this.drawMode !== 'place') {
                this.setStatusInfo('配置モードに切り替えてください。');
                return;
            }
            this.placeInterlockingElement('shuntingLever');
        });
        
        document.getElementById('markerLeverBtn').addEventListener('click', () => {
            if (this.appMode !== 'edit' || this.drawMode !== 'place') {
                this.setStatusInfo('配置モードに切り替えてください。');
                return;
            }
            this.placeInterlockingElement('markerLever');
        });
        
        document.getElementById('throughLeverBtn').addEventListener('click', () => {
            if (this.appMode !== 'edit' || this.drawMode !== 'place') {
                this.setStatusInfo('配置モードに切り替えてください。');
                return;
            }
            this.placeInterlockingElement('throughLever');
        });
        
        document.getElementById('destButtonBtn').addEventListener('click', () => {
            if (this.appMode !== 'edit' || this.drawMode !== 'place') {
                this.setStatusInfo('配置モードに切り替えてください。');
                return;
            }
            this.placeInterlockingElement('destButton');
        });

        // 線路パーツボタンのイベントリスナーを更新
        const trackButtons = [
            'straight',
            'point-left',
            'point-right',
            'double-slip',
            'double-slipX',
            'crossing',
            'end',
            'straightInsulation'
        ];

        trackButtons.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                const originalClick = btn.onclick;
                btn.onclick = (e) => {
                    if (this.appMode !== 'edit' || this.drawMode !== 'place') {
                        this.setStatusInfo('配置モードに切り替えてください。');
                        return;
                    }
                    if (originalClick) originalClick.call(this, e);
                };
            }
        });

        // 連動要素ボタンのイベントリスナーを更新
        const interlockingButtons = [
            'signalLeverBtn',
            'shuntingLeverBtn',
            'markerLeverBtn',
            'throughLeverBtn',
            'destButtonBtn'
        ];

        interlockingButtons.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                const originalClick = btn.onclick;
                btn.onclick = (e) => {
                    if (this.appMode !== 'edit' || this.drawMode !== 'place') {
                        this.setStatusInfo('配置モードに切り替えてください。');
                        return;
                    }
                    if (originalClick) originalClick.call(this, e);
                };
            }
        });

        // 進路設定関連のボタン
        document.getElementById('autoRouteBtn').addEventListener('click', () => {
            // 編集モードでのみ有効
            if (this.appMode !== 'edit') {
                this.setStatusInfo('編集モードに切り替えてください。');
                return;
            }
            // 新しい進路生成アルゴリズムの呼び出し
            routeManager.generateAutoRoute();
        });
        
        // 選択対象ラジオボタンのイベント
        const selectTrackRadio = document.getElementById('selectTrackRadio');
        const selectElementRadio = document.getElementById('selectElementRadio');
        if (selectTrackRadio && selectElementRadio) {
            selectTrackRadio.addEventListener('change', () => {
                if (selectTrackRadio.checked) this.selectionTarget = 'track';
            });
            selectElementRadio.addEventListener('change', () => {
                if (selectElementRadio.checked) this.selectionTarget = 'element';
            });
        }

        // レイアウト保存ボタン
        document.getElementById('exportLayoutBtn').addEventListener('click', () => {
            this.exportLayoutAsJson();
        });

        // 進路候補モーダルの閉じるボタン
        const closeRouteModalBtn = document.getElementById('closeRouteModalBtn');
        if (closeRouteModalBtn) {
            closeRouteModalBtn.addEventListener('click', () => {
                document.getElementById('routeModal').classList.remove('show');
            });
        }

        // --- デバッグ用データ保存ボタンを追加 ---
        const debugBtn = document.createElement('button');
        debugBtn.id = 'debugSaveBtn';
        debugBtn.textContent = 'デバッグデータ保存';
        debugBtn.title = '進路・候補・線路データをJSONで保存';
        debugBtn.style.marginLeft = '10px';
        debugBtn.addEventListener('click', () => {
            this.saveDebugData();
        });
        const toolbar = document.getElementById('toolbar');
        if (toolbar) toolbar.appendChild(debugBtn);
    }

    // レイアウトデータをJSONでエクスポート
    exportLayoutAsJson() {
        // tracksを配列化
        const tracksArray = Array.isArray(this.trackManager.tracks)
            ? this.trackManager.tracks
            : Array.from(this.trackManager.tracks.values ? this.trackManager.tracks.values() : Object.values(this.trackManager.tracks));
        const layoutData = {
            tracks: tracksArray.map(track => track.toJSON ? track.toJSON() : track),
            startLevers: this.interlockingManager.startLevers,
            destinationButtons: this.interlockingManager.destinationButtons,
            trackInsulations: this.interlockingManager.trackInsulations
        };
        const json = JSON.stringify(layoutData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'layout.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // デバッグ用データ保存
    saveDebugData() {
        const data = {
            routes: window.routeManager ? Array.from(window.routeManager.routes.values()) : [],
            routeCandidates: window.routeManager ? window.routeManager.routeCandidates : [],
            tracks: this.trackManager ? (Array.isArray(this.trackManager.tracks) ? this.trackManager.tracks : Array.from(this.trackManager.tracks.values ? this.trackManager.tracks.values() : Object.values(this.trackManager.tracks))) : []
        };
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'debug_data.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // プレビュー要素を作成するヘルパーメソッド
    createPreviewElement(elementType, elementInfo) {
        let previewId = `preview_${Date.now()}`;
        
        if (elementType.includes('Lever')) {
            this.currentPreviewElement = new StartLever(previewId, elementInfo.type, {x: 0, y: 0}, null);
        } else if (elementType === 'destButton') {
            this.currentPreviewElement = new DestinationButton(previewId, {x: 0, y: 0}, null);
        } else if (elementType.includes('Insulation')) {
            this.currentPreviewElement = new TrackInsulation(previewId, {x: 0, y: 0}, elementInfo.type, 0);
        }
    }
    
    // 位置が既存の要素と重複しているかチェックするメソッド
    checkOverlappingPosition(position) {
        if (!this.interlockingManager) return false;
        
        const hitDistance = 20; // 重複と判定する距離
        
        // 発点てこと位置の重複チェック
        for (const lever of this.interlockingManager.startLevers) {
            const dx = lever.position.x - position.x;
            const dy = lever.position.y - position.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < hitDistance) return true;
        }
        
        // 着点ボタンと位置の重複チェック
        for (const button of this.interlockingManager.destinationButtons) {
            const dx = button.position.x - position.x;
            const dy = button.position.y - position.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < hitDistance) return true;
        }
        
        // 絶縁要素と位置の重複チェック
        for (const insulation of this.interlockingManager.trackInsulations) {
            const dx = insulation.position.x - position.x;
            const dy = insulation.position.y - position.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < hitDistance) return true;
        }
        
        return false;
    }
    
    // 既存の配置要素と重複しない位置を見つけるメソッド
    findNonOverlappingPosition(position, elementType) {
        if (!this.interlockingManager) return position;
        
        // 元の位置が重複していなければそのまま返す
        if (!this.checkOverlappingPosition(position)) return position;
        
        // 元の位置が重複している場合、グリッド位置をずらして非重複位置を探す
        const gridSize = CONFIG.CANVAS.GRID_SIZE;
        const offsets = [
            { x: gridSize, y: 0 },      // 右
            { x: 0, y: gridSize },      // 下
            { x: -gridSize, y: 0 },     // 左
            { x: 0, y: -gridSize },     // 上
            { x: gridSize, y: gridSize },   // 右下
            { x: -gridSize, y: gridSize },  // 左下
            { x: -gridSize, y: -gridSize }, // 左上
            { x: gridSize, y: -gridSize }   // 右上
        ];
        
        for (const offset of offsets) {
            const newPos = {
                x: position.x + offset.x,
                y: position.y + offset.y
            };
            
            if (!this.checkOverlappingPosition(newPos)) {
                return newPos;
            }
        }
        
        // すべて重複する場合は、少し大きめに離す
        return {
            x: position.x + gridSize * 2,
            y: position.y + gridSize * 2
        };
    }
    
    // 連動要素を配置
    placeInterlockingElement(elementType) {
        // --- 追加: 線路パーツボタンのアクティブ解除 ---
        this.updateTrackPartButtonState(null);
        // --- 追加: 連動要素ボタンのアクティブ化 ---
        const interlockingButtonMap = {
            signalLever: 'signalLeverBtn',
            shuntingLever: 'shuntingLeverBtn',
            markerLever: 'markerLeverBtn',
            throughLever: 'throughLeverBtn',
            destButton: 'destButtonBtn'
        };
        const btnId = interlockingButtonMap[elementType];
        if (btnId) {
            this.updateTrackPartButtonState(btnId);
        }
        // すでに配置中の要素やプレビューがあればキャンセル・クリア
        if (this.isPlacingElement || this.interlockingManager.editModeState.selectedElement) {
            this.cancelElementPlacement();
            this.interlockingManager.editModeState.selectedElement = null;
            this.interlockingManager.editModeState.elementType = null;
            this.interlockingManager.editModeState.isDragging = false;
        }
        // --- 直線配置モードの一時変数リセット・placingPartType上書き（既存追加分） ---
        this._placingStraightStart = null;
        this._placingStraightPreview = false;
        this._previewPlacingTrack = null;
        this._previewPlacingTrackId = null;
        this._previewPlacingTrackBaseEndpoints = null;
        this._previewPlacingTrackRotation = 0;
        this._isDraggingPreview = false;
        this.placingPartType = elementType;
        // --- ここまで ---
        
        // 編集モードでのみ処理
        if (this.appMode !== 'edit' || this.drawMode !== 'place') {
            this.setStatusInfo('配置モードに切り替えてください。');
            return;
        }
        
        // 配置する要素のタイプに応じて処理を分岐
        const elementTypeMap = {
            // 発点てこ
            'signalLever': { type: 'signal', title: '信号てこ(赤)' },
            'shuntingLever': { type: 'shunting_signal', title: '入換てこ(白)' },
            'markerLever': { type: 'shunting_marker', title: '入換標識てこ(緑)' },
            'throughLever': { type: 'through_lever', title: '開通てこ(黄)' },
            
            // 着点ボタン
            'destButton': { type: 'destination_button', title: '着点ボタン' },
            
            // 線路絶縁
            'straightInsulation': { type: 'straight', title: '直線絶縁' },
            'crossInsulation': { type: 'cross', title: '絶縁クロス' }
        };
        
        const elementInfo = elementTypeMap[elementType];
        if (!elementInfo) return;
        
        // ステータス表示
        this.setStatusInfo(`${elementInfo.title}を配置します。配置後、関連付ける線路をクリックしてください。`);
        
        // ユニークIDを生成
        const id = `${elementType}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        
        // マウス位置を取得
        const mousePos = this.getScaledMousePosition(this.canvas.lastMouseMoveEvent || 
            { clientX: this.canvas.trackCanvas.width / 2, clientY: this.canvas.trackCanvas.height / 2 });
        const snappedPos = this.snapToGrid(mousePos);
        
        // インターロッキング要素のタイプに応じて要素を追加
        let addedElement = null;
        
        if (elementType.includes('Lever')) {
            // 発点てこを追加（trackIdは後で設定）
            addedElement = this.interlockingManager.addStartLever({
                id: id,
                type: elementInfo.type,
                x: snappedPos.x,
                y: snappedPos.y,
                trackId: null
            });
        } else if (elementType === 'destButton') {
            // 着点ボタンを追加（trackIdは後で設定）
            addedElement = this.interlockingManager.addDestinationButton({
                id: id,
                x: snappedPos.x,
                y: snappedPos.y,
                trackId: null
            });
        } else if (elementType.includes('Insulation')) {
            // 線路絶縁を追加（trackIdは後で設定）
            addedElement = this.interlockingManager.addTrackInsulation({
                id: id,
                x: snappedPos.x,
                y: snappedPos.y,
                type: elementInfo.type,
                direction: 0
            });
        }
        
        // 要素が追加されたら、ドラッグ操作を開始
        if (addedElement) {
            // 後続のクリックイベントをブロックするフラグを設定
            this.canvas.blockNextClick = true;
            
            // 要素を選択状態にする
            this.interlockingManager.editModeState.selectedElement = addedElement;
            this.interlockingManager.editModeState.elementType = elementType.includes('Lever') ? 'lever' : 
                                                               elementType === 'destButton' ? 'button' : 'insulation';
            
            // ドラッグ状態を設定
            this.interlockingManager.editModeState.isDragging = true;
            
            // 最後のマウス位置を保存
            this.interlockingManager.editModeState.lastMouseX = snappedPos.x;
            this.interlockingManager.editModeState.lastMouseY = snappedPos.y;
            
            // キャンバスを再描画
            this.canvas.draw();
            
            // マウス移動で要素を追従させるハンドラを設定
            const moveHandler = (e) => {
                const pos = this.getScaledMousePosition(e);
                const snappedPos = this.snapToGrid(pos);
                
                // 要素の位置を更新
                addedElement.x = snappedPos.x;
                addedElement.y = snappedPos.y;
                
                // 最後のマウス位置を更新
                this.interlockingManager.editModeState.lastMouseX = snappedPos.x;
                this.interlockingManager.editModeState.lastMouseY = snappedPos.y;
                
                // キャンバスを再描画
                this.canvas.draw();
            };
            
            const upHandler = (e) => {
                // マウスアップ時の処理
                this.interlockingManager.editModeState.isDragging = false;
                
                // マウス位置を取得
                const pos = this.getScaledMousePosition(e);
                const snappedPos = this.snapToGrid(pos);
                
                // 要素の位置を最終確定
                addedElement.x = snappedPos.x;
                addedElement.y = snappedPos.y;
                
                // イベントリスナーを削除
                this.canvas.trackCanvas.removeEventListener('mousemove', moveHandler);
                this.canvas.trackCanvas.removeEventListener('mouseup', upHandler, true);
                
                // 線路選択モードに移行
                this.setStatusInfo(`${elementInfo.title}を配置しました。関連付ける線路をクリックしてください。`);
                
                // 線路選択のためのクリックイベントを設定
                const trackSelectHandler = (e) => {
                    const mousePos = this.canvas.getMousePosition(e);
                    const clickedTrack = this.canvas.findTrackAtPosition(mousePos.x, mousePos.y);
                    
                    if (clickedTrack) {
                        // 選択された線路に要素を関連付け
                        addedElement.trackId = clickedTrack.id;
                        
                        // 配置完了メッセージを表示
                        this.setStatusInfo(`${elementInfo.title}を線路に関連付けました。配置を継続できます。`);
                        
                        // --- ここでアクティブ解除 ---
                        this.updateTrackPartButtonState(null);
                        
                        // 選択状態を解除
                        this.interlockingManager.editModeState.selectedElement = null;
                        this.interlockingManager.editModeState.elementType = null;
                        
                        // キャンバスを再描画
                        this.canvas.draw();
                        
                        // イベントリスナーを削除
                        this.canvas.trackCanvas.removeEventListener('click', trackSelectHandler);
                    }
                };
                
                // 線路選択のためのクリックイベントを追加
                this.canvas.trackCanvas.addEventListener('click', trackSelectHandler);
                
                // キャンバスを再描画
                this.canvas.draw();
                
                // イベントをキャンセルして、後続のイベント発火を防止
                e.stopPropagation();
                e.preventDefault();
            };
            
            // イベントリスナーをキャプチャフェーズで設定して確実に処理
            this.canvas.trackCanvas.addEventListener('mousemove', moveHandler);
            this.canvas.trackCanvas.addEventListener('mouseup', upHandler, { once: true, capture: true });
            // 配置直後に自動で線路選択モードに入る
            setTimeout(() => {
                let type = 'insulation';
                if (elementType.includes('Lever')) type = 'lever';
                else if (elementType === 'destButton') type = 'button';
                this.startTrackReassignment(addedElement, type);
                // 配置後も選択状態やモードはクリアしない（連続配置のため）
                // this.canvas.selectedTrack = null;
                // this.canvas.selectedEndpoint = null;
                // this.interlockingManager.editModeState.selectedElement = null;
                // this.interlockingManager.editModeState.elementType = null;
                // this.canvas.draw();
            }, 0);
        }
    }
    
    // キャンセル処理を更新
    cancelElementPlacement() {
        // プレビューや選択中の要素をクリア
        this.currentPreviewElement = null;

        // 配置中フラグをクリア
        this.isPlacingElement = false;
        this.placingElementType = null;
        this.placingElementInfo = null;

        // --- 追加ここから ---
        // 連動要素配置時のイベントリスナーを解除
        if (this._interlockingMoveHandler) {
            this.canvas.trackCanvas.removeEventListener('mousemove', this._interlockingMoveHandler);
            this._interlockingMoveHandler = null;
        }
        if (this._interlockingUpHandler) {
            this.canvas.trackCanvas.removeEventListener('mouseup', this._interlockingUpHandler, true);
            this._interlockingUpHandler = null;
        }
        if (this._interlockingTrackSelectHandler) {
            this.canvas.trackCanvas.removeEventListener('click', this._interlockingTrackSelectHandler);
            this._interlockingTrackSelectHandler = null;
        }
        // 未確定の一時要素があればコレクションから削除
        if (this.interlockingManager && this.interlockingManager.editModeState.selectedElement) {
            const elem = this.interlockingManager.editModeState.selectedElement;
            const type = this.interlockingManager.editModeState.elementType;
            if (type === 'lever') {
                this.interlockingManager.startLevers = this.interlockingManager.startLevers.filter(l => l !== elem);
            } else if (type === 'button') {
                this.interlockingManager.destinationButtons = this.interlockingManager.destinationButtons.filter(b => b !== elem);
            } else if (type === 'insulation') {
                this.interlockingManager.trackInsulations = this.interlockingManager.trackInsulations.filter(i => i !== elem);
            }
            this.interlockingManager.editModeState.selectedElement = null;
            this.interlockingManager.editModeState.elementType = null;
            this.interlockingManager.editModeState.isDragging = false;
        }
        // --- 追加ここまで ---

        // ステータスを更新
        this.setStatusInfo('配置をキャンセルしました。');

        // 画面更新
        this.canvas.draw();
    }

    // 指定された位置に最も近い線路IDを取得
    getNearestTrackId(element) {
        // elementが未定義の場合はnullを返す
        if (!element) {
            return null;
        }

        let minDistance = Infinity;
        let nearestTrackId = null;

        // elementの位置を取得（element自体が座標を持つ場合とposition/x,yを持つ場合の両方に対応）
        let elementX, elementY;
        if (typeof element.x === 'number' && typeof element.y === 'number') {
            elementX = element.x;
            elementY = element.y;
        } else if (element.position && typeof element.position.x === 'number' && typeof element.position.y === 'number') {
            elementX = element.position.x;
            elementY = element.position.y;
        } else {
            // 有効な位置情報が取得できない場合はnullを返す
            return null;
        }

        // 全ての線路要素との距離を計算
        this.trackManager.tracks.forEach(track => {
            // 線路の位置は最初の端点から取得
            const trackPos = track.endpoints[0];
            if (!trackPos) return; // 端点がない場合はスキップ

            const distance = Math.sqrt(
                Math.pow(trackPos.x - elementX, 2) + 
                Math.pow(trackPos.y - elementY, 2)
            );

            if (distance < minDistance) {
                minDistance = distance;
                nearestTrackId = track.id;
            }
        });

        // 最も近い線路が一定距離以内の場合のみそのIDを返す
        return minDistance <= 50 ? nearestTrackId : null;
    }

    // ボタンのトグル状態を更新
    updateToggleButtonStates() {
        const toggleGridBtn = document.getElementById('toggleGridBtn');
        const toggleEndpointsBtn = document.getElementById('toggleEndpointsBtn');
        const toggleConnectionsBtn = document.getElementById('toggleConnectionsBtn');
        const toggleLabelsBtn = document.getElementById('toggleLabelsBtn');
        // 接続モード時は接続関連のボタンを強制的にアクティブにする
        if (this.drawMode === 'connect') {
            toggleEndpointsBtn.classList.add('active');
            toggleConnectionsBtn.classList.add('active');
            toggleLabelsBtn.classList.add('active');
            toggleGridBtn.classList.toggle('active', this.canvas.displayOptions.showGrid);
        } else {
            // ON（表示中）ならactive、OFFなら非active
            toggleGridBtn.classList.toggle('active', this.canvas.displayOptions.showGrid);
            toggleEndpointsBtn.classList.toggle('active', this.canvas.displayOptions.showEndpoints);
            toggleConnectionsBtn.classList.toggle('active', this.canvas.displayOptions.showConnections);
            toggleLabelsBtn.classList.toggle('active', this.canvas.displayOptions.showConnectionLabels);
        }
    }

    // モードの設定を更新
    setMode(mode) {
        // 現在配置モードが進行中であればキャンセル
        if (this.isPlacingElement) {
            this.cancelElementPlacement();
        }
        
        // 描画モードを設定
        this.drawMode = mode;
        this.canvas.setDrawMode(mode);
        
        // 接続モードに切り替えるときは選択状態とハイライトを完全にクリア
        if (mode === 'connect') {
            this.canvas.selectedTrack = null;
            this.canvas.selectedEndpoint = null;
            this.interlockingManager.editModeState.selectedElement = null;
            this.interlockingManager.editModeState.elementType = null;
            this.canvas.draw(); // キャンバスを再描画して変更を反映
        }
        
        // アクティブな描画モードボタンを設定
        const buttonIds = ['cursorBtn', 'connectBtn', 'deleteBtn', 'placeBtn'];
        buttonIds.forEach(id => {
            const button = document.getElementById(id);
            if (button) {
                if (id === mode + 'Btn') {
                    button.classList.add('active');
                } else {
                    button.classList.remove('active');
                }
            }
        });

        // 描画モードに応じてツールバーの状態を更新
        this.updateEditToolButtons();

        // モード変更時のステータス表示
        const modeMessages = {
            'cursor': '選択モード: パーツを選択して編集できます',
            'connect': '接続モード: 線路同士を接続できます',
            'delete': '削除モード: パーツを削除できます',
            'place': '配置モード: 新しいパーツを配置できます'
        };
        this.setStatusInfo(modeMessages[mode] || 'モードを選択してください');
    }

    // 編集ツールボタンの状態を更新
    updateEditToolButtons() {
        // 編集関連のボタンID
        const editButtons = [
            'cursorBtn',
            'connectBtn',
            'deleteBtn',
            'placeBtn'
        ];

        // パーツ配置ボタンID
        const partButtons = [
            'straight',
            'point-left',
            'point-right',
            'double-slip',
            'double-slipX',
            'crossing',
            'end',
            'straightInsulation',
            'textLabel',
            'signalLeverBtn',
            'shuntingLeverBtn',
            'markerLeverBtn',
            'throughLeverBtn',
            'destButtonBtn'
        ];

        // すべてのボタンを処理
        [...editButtons, ...partButtons].forEach(id => {
            const button = document.getElementById(id);
            if (!button) return;

            if (this.appMode === 'edit') {
                if (editButtons.includes(id)) {
                    // 編集ツールボタンは常に有効
                    button.removeAttribute('disabled');
                    button.style.opacity = '1';
                    button.style.cursor = 'pointer';
                } else if (this.drawMode === 'place') {
                    // 配置モード時はパーツ配置ボタンを有効化
                    button.removeAttribute('disabled');
                    button.style.opacity = '1';
                    button.style.cursor = 'pointer';
                } else {
                    // その他のモード時はパーツ配置ボタンを無効化
                    button.setAttribute('disabled', 'true');
                    button.style.opacity = '0.5';
                    button.style.cursor = 'not-allowed';
                }
            } else {
                // 操作モードの場合はすべて無効化
                button.setAttribute('disabled', 'true');
                button.style.opacity = '0.5';
                button.style.cursor = 'not-allowed';
            }
        });
    }

    // 描画ツールボタンの状態を更新（既存のメソッドを削除）
    updateDrawToolButtons() {
        this.updateEditToolButtons();
    }

    // アクティブボタンの設定
    setActiveButton(id) {
        const buttons = document.querySelectorAll('#toolbar button');
        buttons.forEach(button => {
            if (button.id === id) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });
    }

    // キーボードショートカットの設定
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            this.handleKeyDown(e);
        });
    }

    // キーボードショートカットのハンドラ
    handleKeyDown(e) {
        // Ctrl キーが押されている場合の特殊ショートカット
        if (e.ctrlKey) {
            switch (e.key) {
                case 's':
                    e.preventDefault();
                    // 保存処理
                    document.getElementById('save').click();
                    return;
                case 'o':
                    e.preventDefault();
                    // 読み込み処理
                    document.getElementById('load').click();
            return;
            }
        }
        
        // 配置モード中はショートカットを無効化
        if (this.isPlacingElement) {
            if (e.key === 'Escape') {
                e.preventDefault();
            this.cancelElementPlacement();
            }
            return;
        }
        
        // 選択中のテキストラベルがあるか確認
        const selectedLabel = document.querySelector('.text-label.selected');
        
        if (selectedLabel) {
            // 矢印キーによる移動
            if (e.key.startsWith('Arrow')) {
                e.preventDefault();
                
                const x = parseInt(selectedLabel.dataset.x);
                const y = parseInt(selectedLabel.dataset.y);
                const gridSize = this.canvas.gridSize;
                const moveStep = e.shiftKey ? gridSize * 5 : gridSize;
                
                let newX = x;
                let newY = y;
                
                switch (e.key) {
                    case 'ArrowLeft':
                        newX = x - moveStep;
                break;
                    case 'ArrowRight':
                        newX = x + moveStep;
                break;
                    case 'ArrowUp':
                        newY = y - moveStep;
                break;
                    case 'ArrowDown':
                        newY = y + moveStep;
                break;
                }
                
                // 位置を更新
                selectedLabel.style.left = `${newX}px`;
                selectedLabel.style.top = `${newY}px`;
                selectedLabel.dataset.x = newX;
                selectedLabel.dataset.y = newY;
                
                // プロパティパネルを更新
                this.updateTextLabelProperties(selectedLabel);
                
                return;
            }
            
            // Deleteキーによる削除
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                selectedLabel.remove();
                
                // パーツのプロパティ表示を初期化
                const propertiesContainer = document.getElementById('selected-properties');
                if (propertiesContainer) {
                    propertiesContainer.innerHTML = '<p>パーツを選択してください</p>';
                }
                
                this.setStatusInfo('テキストラベルを削除しました');
                return;
            }
            
            // Enterキーによる編集
            if (e.key === 'Enter') {
                e.preventDefault();
                const position = {
                    x: parseInt(selectedLabel.dataset.x),
                    y: parseInt(selectedLabel.dataset.y)
                };
                this.showTextLabelDialog(position, selectedLabel);
                return;
            }
        }
        
        // 一般的なショートカットキー
        switch (e.key) {
            case 'Delete':
                // 削除モード
                document.getElementById('deleteBtn').click();
                break;
            case 'c':
                // カーソルモード
                document.getElementById('cursorBtn').click();
                break;
            case 'e':
                // 編集モード
                document.getElementById('editModeBtn').click();
                break;
            case 'o':
                // 操作モード
                document.getElementById('operationModeBtn').click();
                break;
            case 'g':
                // グリッド表示切替
                document.getElementById('toggleGridBtn').click();
                break;
            case 'Escape':
                // 配置キャンセル
                this.cancelElementPlacement();
                break;
        }
    }

    // イベントリスナーの設定
    setupEventListeners() {
        // サイドパネル切り替えボタン
        const togglePanelBtn = document.getElementById('togglePanelBtn');
        if (togglePanelBtn) {
            togglePanelBtn.addEventListener('click', () => {
                this.toggleSidePanel();
            });
        }
        
        // ウィンドウのリサイズイベント
        window.addEventListener('resize', () => {
            this.canvas.resizeCanvas();
        });
        
        // トラックキャンバスのクリックイベント
        this.canvas.trackCanvas.addEventListener('click', (e) => {
            // 直線パーツ配置モードの場合（2点指定方式）
            if (this.appMode === 'edit' && this.drawMode === 'place' && this.placingPartType === 'straight') {
                const mousePos = this.canvas.getMousePosition(e);
                const snappedPos = this.snapToGrid(mousePos);
                if (!this._placingStraightStart) {
                    // 1点目（始点）
                    this._placingStraightStart = snappedPos;
                    this.setStatusInfo('直線の始点を指定しました。終点をクリックしてください。');
                    // プレビュー用に記録
                    this._placingStraightPreview = true;
                } else {
                    // 2点目（終点）
                    const start = this._placingStraightStart;
                    const end = snappedPos;
                    const trackId = this.trackManager.generateTrackId();
                    const track = Track.createCustomStraight(trackId, start.x, start.y, end.x, end.y);
                    this.trackManager.addTrack(track);
                    this.setStatusInfo('直線を配置しました。続けて配置できます。');
                    this._placingStraightStart = null;
                    this._placingStraightPreview = false;
                    this.canvas.draw();
                }
                return;
            }
            // パーツ配置モードかつパーツ種別が選択されている場合（直線以外）
            if (this.appMode === 'edit' && this.drawMode === 'place' && this.placingPartType && this.placingPartType !== 'straight') {
                // 仮パーツがなければ生成
                if (!this._previewPlacingTrack) {
                    const mousePos = this.canvas.getMousePosition(e);
                    const snappedPos = this.snapToGrid(mousePos);
                    const trackId = this.trackManager.generateTrackId();
                    let track = null;
                    switch (this.placingPartType) {
                        case 'point-left':
                            track = Track.createPreset(trackId, 'point_left', snappedPos.x, snappedPos.y);
                            break;
                        case 'point-right':
                            track = Track.createPreset(trackId, 'point_right', snappedPos.x, snappedPos.y);
                            break;
                        case 'double-slip':
                            track = Track.createPreset(trackId, 'double_cross', snappedPos.x, snappedPos.y);
                            break;
                        case 'double-slipX':
                            track = Track.createPreset(trackId, 'double_slip_x', snappedPos.x, snappedPos.y);
                            break;
                        case 'crossing':
                            track = Track.createPreset(trackId, 'crossing', snappedPos.x, snappedPos.y);
                            break;
                        case 'end':
                            track = Track.createPreset(trackId, 'end', snappedPos.x, snappedPos.y);
                            break;
                        case 'straightInsulation':
                            track = Track.createPreset(trackId, 'straightInsulation', snappedPos.x, snappedPos.y);
                            break;
                    }
                    // trackがnullの場合は以降の処理をスキップ
                    if (!track) {
                        this.setStatusInfo('パーツの生成に失敗しました。', true);
                        return;
                    }
                    this._previewPlacingTrack = track;
                    this._previewPlacingTrackId = trackId;
                    this._previewPlacingTrackBaseEndpoints = track.endpoints.map(pt => ({ x: pt.x, y: pt.y }));
                    this._previewPlacingTrackRotation = 0; // 回転角（ラジアン）
                    this._isDraggingPreview = true;
                    this._dragOffset = { x: 0, y: 0 };
                    this.canvas.draw();
                } else {
                    // クリックで確定配置
                    // 仮パーツの現在の端点座標・回転角そのままで配置
                    this.trackManager.addTrack(this._previewPlacingTrack);
                    this.updatePointsList(); // ここで必ずポイント一覧を更新
                    this.setStatusInfo('パーツを配置しました。続けて配置できます。');
                    if (this._previewPlacingTrack.type && (
                        this._previewPlacingTrack.type.startsWith('point_') ||
                        this._previewPlacingTrack.type === 'double_cross' ||
                        this._previewPlacingTrack.type === 'double_slip_x'
                    )) {
                        this.updateSelectedProperties(this._previewPlacingTrack, 'track', {onlyPointDcc: true});
                    }
                    this._previewPlacingTrack = null;
                    this._previewPlacingTrackId = null;
                    this._previewPlacingTrackBaseEndpoints = null;
                    this._previewPlacingTrackRotation = 0;
                    this._isDraggingPreview = false;
                    this.canvas.draw();
                }
                return;
            }
            // 配置中の場合は何もしない
            if (this.isPlacingElement) return;
            // クリックされたトラックを取得
            const mousePos = this.canvas.getMousePosition(e);
            const track = this.canvas.findTrackAtPosition(mousePos.x, mousePos.y);
            // トラックのクリック処理
            this.handleTrackClick(track, e);
        });
        
        // プレビュー描画・ドラッグ追従
        this.canvas.trackCanvas.addEventListener('mousemove', (e) => {
            // 直線パーツプレビュー
            if (this.appMode === 'edit' && this.drawMode === 'place' && this.placingPartType === 'straight' && this._placingStraightStart) {
                const mousePos = this.canvas.getMousePosition(e);
                const snappedPos = this.snapToGrid(mousePos);
                this.canvas.draw();
                const ctx = this.canvas.trackCanvas.getContext('2d');
                ctx.save();
                ctx.strokeStyle = '#2196F3';
                ctx.lineWidth = 3;
                ctx.setLineDash([8, 8]);
                ctx.beginPath();
                ctx.moveTo(this._placingStraightStart.x, this._placingStraightStart.y);
                ctx.lineTo(snappedPos.x, snappedPos.y);
                ctx.stroke();
                ctx.restore();
            }
            // 分岐器などの仮パーツプレビュー
            if (this.appMode === 'edit' && this.drawMode === 'place' && this.placingPartType && this.placingPartType !== 'straight' && this._previewPlacingTrack && this._previewPlacingTrackBaseEndpoints) {
                const mousePos = this.canvas.getMousePosition(e);
                const snappedPos = this.snapToGrid(mousePos);
                // 端点0をマウス位置に合わせて、初期形状を基準に全端点を再計算＋回転
                const base = this._previewPlacingTrackBaseEndpoints[0];
                const offsetX = snappedPos.x - base.x;
                const offsetY = snappedPos.y - base.y;
                // 回転角
                const theta = this._previewPlacingTrackRotation || 0;
                // 回転＋平行移動
                this._previewPlacingTrack.endpoints = this._previewPlacingTrackBaseEndpoints.map(pt => {
                    // 基準点からの相対座標
                    const relX = pt.x - base.x;
                    const relY = pt.y - base.y;
                    // 回転
                    const rotX = relX * Math.cos(theta) - relY * Math.sin(theta);
                    const rotY = relX * Math.sin(theta) + relY * Math.cos(theta);
                    // 平行移動
                    return {
                        x: snappedPos.x + rotX,
                        y: snappedPos.y + rotY
                    };
                });
                this.canvas.draw();
                // 仮パーツを本番ロジックで描画（色・透明度のみプレビュー用に変更）
                const ctx = this.canvas.trackCanvas.getContext('2d');
                ctx.save();
                ctx.globalAlpha = 0.5;
                ctx.strokeStyle = '#FF9800';
                ctx.setLineDash([6, 6]);
                this.canvas.drawTrack(this._previewPlacingTrack, this.canvas.scale, true);
                ctx.setLineDash([]);
                ctx.restore();
            }
        });
        
        // トラックキャンバスの右クリックイベント
        this.canvas.trackCanvas.addEventListener('contextmenu', (e) => {
            e.preventDefault(); // デフォルトのコンテキストメニューを表示しない
            
            // 配置中の場合は配置をキャンセル
            if (this.isPlacingElement) {
                this.cancelElementPlacement();
                return;
            }

            // 直線配置中の場合は配置をキャンセル
            if (this.canvas.drawState && this.canvas.drawState.isDrawing) {
                this.canvas.drawState = {
                    isDrawing: false,
                    startPoint: null,
                    previewTrack: null
                };
                this.canvas.draw();
                this.setStatusInfo('直線の配置をキャンセルしました');
                return;
            }
        });
        
        // マウス移動イベントを更新
        this.canvas.trackCanvas.addEventListener('mousemove', (e) => {
            // 最後のマウス位置を保存
            this.canvas.lastMouseMoveEvent = e;

            // 編集モードでの要素移動
            if (this.appMode === 'edit' && !this.isPlacingElement) {
                const mousePos = this.getScaledMousePosition(e);
                
                // 連動要素の移動
                if (this.interlockingManager.editModeState.selectedElement && 
                    this.interlockingManager.editModeState.isDragging) {
                    const element = this.interlockingManager.editModeState.selectedElement;
                    const snappedPos = this.snapToGrid(mousePos);
                    
                    // 要素の位置を更新
                    element.x = snappedPos.x;
                    element.y = snappedPos.y;
                    
                    // 最後のマウス位置を更新
                    this.interlockingManager.editModeState.lastMouseX = snappedPos.x;
                    this.interlockingManager.editModeState.lastMouseY = snappedPos.y;
                    
                    // キャンバスを再描画
                    this.canvas.draw();
                }
            }
        });

        // マウスダウンイベントを追加
        this.canvas.trackCanvas.addEventListener('mousedown', (e) => {
            if (this.appMode === 'edit' && !this.isPlacingElement) {
                const mousePos = this.canvas.getMousePosition(e);
                
                // 連動要素のドラッグ開始
                if (this.interlockingManager.editModeState.selectedElement) {
                    this.interlockingManager.editModeState.isDragging = true;
                    this.interlockingManager.editModeState.lastMouseX = mousePos.x;
                    this.interlockingManager.editModeState.lastMouseY = mousePos.y;
                }
            }
        });

        // マウスアップイベントを追加
        this.canvas.trackCanvas.addEventListener('mouseup', (e) => {
            if (this.appMode === 'edit') {
                // ドラッグ終了
                if (this.interlockingManager.editModeState.isDragging) {
                    this.interlockingManager.editModeState.isDragging = false;
                    
                    // 要素の位置を最終確定
                    const mousePos = this.canvas.getMousePosition(e);
                    const snappedPos = this.canvas.snapToGrid(mousePos);
                    const element = this.interlockingManager.editModeState.selectedElement;
                    
                    if (element) {
                        element.x = snappedPos.x;
                        element.y = snappedPos.y;
                        this.canvas.draw();
                    }
                }
            }
        });
    }

    // サイドパネルの表示/非表示切り替え
    toggleSidePanel() {
        this.isPanelVisible = !this.isPanelVisible;
        const togglePanelBtn = document.getElementById('togglePanelBtn');
        
        if (this.isPanelVisible) {
            this.sidePanel.style.display = 'flex';
            togglePanelBtn.textContent = '≫';
            // パネルが表示されている場合は、パネルの左端に配置
            togglePanelBtn.style.right = '316px'; // サイドパネル幅(300px) + パディング(16px)
        } else {
            this.sidePanel.style.display = 'none';
            togglePanelBtn.textContent = '≪';
            // パネルが非表示の場合は、ウィンドウの右端に配置
            togglePanelBtn.style.right = '16px';
        }
        
        // キャンバスのリサイズを行ってからキャンバスを再描画
        this.canvas.resizeCanvas();
        this.canvas.draw();
    }

    // ポイント一覧の更新
    updatePointsList() {
        const pointsContainer = document.getElementById('points-container');
        if (!pointsContainer) return;
        
        const points = this.trackManager.getPoints();
        
        // コンテナをクリア
        pointsContainer.innerHTML = '';
        
        if (points.length === 0) {
            pointsContainer.innerHTML = '<p>ポイントがありません</p>';
            return;
        }
        
        // 各ポイントのHTML要素を生成
        points.forEach((point, index) => {
            const pointItem = document.createElement('div');
            pointItem.className = 'point-item';
            
            const pointInfo = document.createElement('div');
            pointInfo.className = 'point-info';
            
            const pointLabel = document.createElement('span');
            pointLabel.className = 'point-label';
            pointLabel.textContent = `ポイント #${index + 1}`;
            
            const pointDirection = document.createElement('div');
            pointDirection.className = 'point-direction';
            
            // DCC出力反転設定を考慮した方向の表示
            const track = this.trackManager.getTrack(point.id);
            const isInverted = track && track.invertDcc;
            const displayDirection = isInverted ? 
                (point.direction === 'normal' ? 'reverse' : 'normal') : 
                point.direction;
            
            const directionIndicator = document.createElement('div');
            directionIndicator.className = `direction-indicator ${displayDirection === 'normal' ? 'direction-normal' : 'direction-reverse'}`;
            
            const directionText = document.createElement('span');
            directionText.textContent = displayDirection === 'normal' ? '直進' : '分岐';
            
            // 反転設定がある場合はそれを表示
            if (isInverted) {
                directionText.textContent += ' (DCC反転)';
            }
            
            pointDirection.appendChild(directionIndicator);
            pointDirection.appendChild(directionText);
            
            const pointControls = document.createElement('div');
            pointControls.className = 'point-controls';
            
            const addressInput = document.createElement('input');
            addressInput.type = 'number';
            addressInput.className = 'address-input';
            addressInput.value = point.address || '';
            addressInput.min = 0;
            addressInput.max = 2044;
            // ラベルと一緒にまとめる
            const addressLabel = document.createElement('label');
            addressLabel.textContent = 'アドレス: ';
            addressLabel.appendChild(addressInput);
            pointControls.appendChild(addressLabel);
            
            const switchButton = document.createElement('button');
            switchButton.className = 'switch-button';
            switchButton.textContent = 'ポイント切替';
            
            // ポイント切替ボタンのイベント
            switchButton.addEventListener('click', async () => {
                // ボタンを一時的に無効化
                switchButton.disabled = true;
                
                try {
                    // 現在のポイントの状態を取得
                    const track = this.trackManager.getTrack(point.id);
                    if (!track) {
                        throw new Error('ポイントが見つかりません');
                    }
                    
                    // 現在の方向を確認して反対方向に切り替え
                    const currentDirection = track.pointDirection;
                    const newDirection = currentDirection === 'normal' ? 'reverse' : 'normal';
                    
                    // ポイント切替処理
                    const success = await this.trackManager.switchPoint(point.id, newDirection);
                    
                    if (success) {
                        // DCC出力反転設定を考慮した方向の表示
                        const isInverted = track.invertDcc;
                        const displayDirection = isInverted ? 
                            (newDirection === 'normal' ? 'reverse' : 'normal') : 
                            newDirection;
                        
                        // 表示を更新
                        directionIndicator.className = `direction-indicator ${displayDirection === 'normal' ? 'direction-normal' : 'direction-reverse'}`;
                        directionText.textContent = displayDirection === 'normal' ? '直進' : '分岐';
                        
                        // 反転設定がある場合はそれを表示
                        if (isInverted) {
                            directionText.textContent += ' (DCC反転)';
                        }
                        
                        // キャンバスを再描画して変更を反映
                        this.canvas.draw();
                        
                        // ステータス表示
                        this.setStatusInfo(`ポイント ${index + 1} を${displayDirection === 'normal' ? '直進' : '分岐'}に切り替えました`);
                    } else {
                        this.setStatusInfo('ポイント切替に失敗しました', true);
                    }
                } catch (error) {
                    console.error('ポイント切替エラー:', error);
                    this.setStatusInfo('ポイント切替でエラーが発生しました', true);
                } finally {
                    // ボタンを再度有効化
                    switchButton.disabled = false;
                }
            });
            
            pointControls.appendChild(switchButton);
            
            pointItem.appendChild(pointInfo);
            pointItem.appendChild(pointDirection);
            pointItem.appendChild(pointControls);
            
            pointsContainer.appendChild(pointItem);
        });
    }

    // 接続状態の更新
    updateConnectionStatus() {
        // DSAirの接続状態を内部変数に保存
        this.isDSAirConnected = DSAir.isConnected;

        if (this.isDSAirConnected) {
            this.connectionStatusDot.classList.remove('status-disconnected');
            this.connectionStatusDot.classList.add('status-connected');
            this.connectionStatusText.textContent = 'DSAir: 接続済み';
        } else {
            this.connectionStatusDot.classList.remove('status-connected');
            this.connectionStatusDot.classList.add('status-disconnected');
            this.connectionStatusText.textContent = 'DSAir: 未接続';
        }
    }

    // ステータス情報の表示
    setStatusInfo(message, isError = false) {
        this.statusInfo.textContent = message;
        if (isError) {
            this.statusInfo.style.color = 'var(--danger-color)';
        } else {
            this.statusInfo.style.color = 'white';
        }
    }

    // --- 進路選択状態管理用の変数を追加 ---
    selectedRouteStartLever = null;
    selectedRouteDestButton = null;

    // トラックのクリック処理
    handleTrackClick(track, event) {
        // --- 進路選択処理（操作モード時） ---
        if (this.appMode === 'operation') {
            const mousePos = this.getScaledMousePosition(event);
            // てこ（発点てこ）がクリックされたか判定
            const lever = this.interlockingManager.startLevers.find(l => {
                const dx = (l.x ?? l.position?.x ?? 0) - mousePos.x;
                const dy = (l.y ?? l.position?.y ?? 0) - mousePos.y;
                return Math.sqrt(dx * dx + dy * dy) < 20;
            });
            if (lever) {
                this.selectedRouteStartLever = lever;
                this.selectedRouteDestButton = null;
                this.setStatusInfo(`発点てこ「${lever.id}」を選択しました。次に着点ボタンをクリックしてください。`);
                return;
            }
            // 着点ボタンがクリックされたか判定
            const button = this.interlockingManager.destinationButtons.find(b => {
                const dx = (b.x ?? b.position?.x ?? 0) - mousePos.x;
                const dy = (b.y ?? b.position?.y ?? 0) - mousePos.y;
                return Math.sqrt(dx * dx + dy * dy) < 20;
            });
            if (button && this.selectedRouteStartLever) {
                this.selectedRouteDestButton = button;
                // --- 追加: routesから該当進路を検索し自動開通 ---
                if (window.routeManager && window.routeManager.routes) {
                    const foundRoute = Array.from(window.routeManager.routes.values()).find(route =>
                        route.lever.id === this.selectedRouteStartLever.id &&
                        route.destination.id === button.id
                    );
                    if (foundRoute) {
                        window.routeManager.activateRoute(foundRoute.id);
                        this.setStatusInfo(`進路「${foundRoute.lever.id}→${foundRoute.destination.id}」を開通しました。`);
                    } else {
                        this.setStatusInfo('該当する進路候補がありません。', true);
                    }
                }
                // 状態リセット
                this.selectedRouteStartLever = null;
                this.selectedRouteDestButton = null;
                return;
            }
            // --- 分岐器クリックで開通方向を切り替え ---
            if (track && track.type && track.type.startsWith('point_')) {
                const newDirection = track.pointDirection === 'normal' ? 'reverse' : 'normal';
                this.trackManager.switchPoint(track.id, newDirection);
                this.setStatusInfo(`ポイントID:${track.id} を${newDirection === 'normal' ? '直進' : '分岐'}に切り替えました`);
                this.canvas.draw();
                return;
            }
            // --- 分岐器・ダブルクロス・ダブルスリップクリックで開通方向を切り替え ---
            if (track && track.type && (track.type.startsWith('point_') || track.type === 'double_cross' || track.type === 'double_slip_x')) {
                const newDirection = track.pointDirection === 'normal' ? 'reverse' : 'normal';
                this.trackManager.switchPoint(track.id, newDirection);
                let typeLabel = 'ポイント';
                if (track.type === 'double_cross') typeLabel = 'ダブルクロス';
                if (track.type === 'double_slip_x') typeLabel = 'ダブルスリップ';
                this.setStatusInfo(`${typeLabel}ID:${track.id} を${newDirection === 'normal' ? '直進' : '分岐'}に切り替えました`);
                this.canvas.draw();
                return;
            }
            // どちらも該当しない場合は通常の選択処理をスキップ
            return;
        }
        // --- 既存の編集モード等の処理はそのまま ---
        // ...（既存のhandleTrackClickの内容をここに残す）...
        // 既存の編集モード等の処理は省略
        if (this.appMode !== 'edit') return;
        const mousePos = this.getScaledMousePosition(event);
        // 直線配置モード時は選択処理をスキップ
        if (this.canvas.drawMode === 'straight') {
            if (this.canvas.drawState && this.canvas.drawState.isDrawing) {
                return;
            } else {
                this.canvas.selectedTrack = null;
                this.canvas.draw();
            }
        }
        // 配置モードの場合
        if (this.drawMode === 'place' && this.isPlacingElement) {
            if (track) {
                this.associateElementWithTrack(track);
                this.setStatusInfo('パーツを配置しました。引き続きパーツを配置できます。');
            }
            return;
        }
        // --- ここから選択対象による分岐 ---
        if (this.selectionTarget === 'track') {
            if (track) {
                // 線路選択処理（従来通り）
                const endpointThreshold = 10 * (this.canvas.trackCanvas.width / this.canvas.trackCanvas.getBoundingClientRect().width);
                let minDistance = Infinity;
                let nearestEndpointIndex = -1;
                track.endpoints.forEach((endpoint, index) => {
                    const dx = endpoint.x - mousePos.x;
                    const dy = endpoint.y - mousePos.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance < minDistance) {
                        minDistance = distance;
                        nearestEndpointIndex = index;
                    }
                });
                if (minDistance <= endpointThreshold) {
                    this.canvas.selectedTrack = track;
                    this.canvas.selectedEndpoint = nearestEndpointIndex;
                    this.setStatusInfo(`端点 ${nearestEndpointIndex + 1} を選択しました`);
                } else {
                    this.canvas.selectedTrack = track;
                    this.canvas.selectedEndpoint = null;
                    this.updateSelectedProperties(track, 'track');
                    this.setStatusInfo(`パーツ ID: ${track.id} を選択しました`);
                }
                this.interlockingManager.editModeState.selectedElement = null;
                this.interlockingManager.editModeState.elementType = null;
                this.canvas.draw();
                return;
            }
        } else if (this.selectionTarget === 'element') {
            // 連動要素のみ選択
            const element = this.interlockingManager._findInterlockingElementAtPosition(mousePos.x, mousePos.y);
            if (element) {
                this.updateSelectedProperties(element.element, element.type);
                this.canvas.selectedTrack = null;
                this.interlockingManager.editModeState.selectedElement = element.element;
                this.interlockingManager.editModeState.elementType = element.type;
                this.interlockingManager.editModeState.lastMouseX = mousePos.x;
                this.interlockingManager.editModeState.lastMouseY = mousePos.y;
                this.canvas.draw();
                return;
            }
        }
        // 何も選択されていない場合
        this.updateSelectedProperties(null);
        this.canvas.selectedTrack = null;
        this.interlockingManager.editModeState.selectedElement = null;
        this.interlockingManager.editModeState.elementType = null;
    }
    
    // クリックされたテキストラベルを見つける
    findClickedTextLabel(event) {
        if (!event) return null;
        
        const mousePos = this.canvas.getMousePosition(event);
        const labels = document.querySelectorAll('.text-label');
        
        for (const label of labels) {
            const labelRect = label.getBoundingClientRect();
            const canvasContainer = document.getElementById('canvas-container');
            const containerRect = canvasContainer.getBoundingClientRect();
            
            // ラベルの位置を計算（スクロールを考慮）
            const labelLeft = parseInt(label.dataset.x);
            const labelTop = parseInt(label.dataset.y);
            const labelWidth = labelRect.width / parseFloat(label.dataset.scale || 1);
            const labelHeight = labelRect.height / parseFloat(label.dataset.scale || 1);
            
            // クリック位置がラベル内にあるか確認
            if (
                mousePos.x >= labelLeft && 
                mousePos.x <= labelLeft + labelWidth && 
                mousePos.y >= labelTop && 
                mousePos.y <= labelTop + labelHeight
            ) {
                return label;
            }
        }
        
        return null;
    }
    
    // テキストラベルのプロパティをパネルに表示
    updateTextLabelProperties(label) {
        const propertiesContainer = document.getElementById('selected-properties');
        if (!propertiesContainer) return;
        
        // データ属性の検証とフォールバック
        const x = parseInt(label.dataset.x);
        const y = parseInt(label.dataset.y);
        const posX = isNaN(x) ? 0 : x;
        const posY = isNaN(y) ? 0 : y;
        
        // 念のため、データ属性を更新
        if (isNaN(x) || isNaN(y)) {
            const rect = label.getBoundingClientRect();
            const canvasContainer = document.getElementById('canvas-container');
            const containerRect = canvasContainer.getBoundingClientRect();
            label.dataset.x = posX;
            label.dataset.y = posY;
        }
        
        // 水平・垂直位置を取得
        const hAlign = label.classList.contains('align-left') ? '左揃え' : 
                        label.classList.contains('align-right') ? '右揃え' : '中央揃え';
        
        const vAlign = label.classList.contains('align-top') ? '上揃え' : 
                        label.classList.contains('align-bottom') ? '下揃え' : '中央揃え';
        
        // テキストの内容を表示（長い場合は省略）
        const textContent = label.textContent.length > 20 ? 
                           label.textContent.substring(0, 20) + '...' : 
                           label.textContent;
        
        // フォント情報
        const fontFamily = label.style.fontFamily || 'Meiryo UI';
        const fontSize = label.style.fontSize || '14px';
        const fontColor = label.style.color || '#ffffff';
        
        // スタイル情報
        const bgColor = label.style.backgroundColor || '透明';
        const border = label.style.borderWidth ? 
                      `${label.style.borderWidth} ${label.style.borderStyle || 'solid'} ${label.style.borderColor || '透明'}` : 
                      'なし';
        
        propertiesContainer.innerHTML = `
            <div class="property-group">
                <h3>テキストラベル</h3>
                <p><strong>テキスト:</strong> ${textContent}</p>
                <p><strong>フォント:</strong> ${fontFamily}, ${fontSize}</p>
                <p><strong>配置:</strong> ${hAlign}, ${vAlign}</p>
                <p><strong>位置:</strong> X=${posX}, Y=${posY}</p>
                <div class="property-actions" style="margin-top: 10px;">
                    <button id="edit-text-label" class="property-action-btn">編集</button>
                    <button id="delete-text-label" class="property-action-btn">削除</button>
                </div>
            </div>
        `;
        
        // 編集ボタンのイベントハンドラ
        document.getElementById('edit-text-label').addEventListener('click', () => {
            const position = {
                x: posX,
                y: posY
            };
            this.showTextLabelDialog(position, label);
        });
        
        // 削除ボタンのイベントハンドラ
        document.getElementById('delete-text-label').addEventListener('click', () => {
            label.remove();
            propertiesContainer.innerHTML = '<p>パーツを選択してください</p>';
            this.setStatusInfo('テキストラベルを削除しました');
        });
    }
    
    // トラックタイプの名称を取得
    getTrackTypeName(type) {
        const typeMap = {
            'straight': '直線',
            'curve': '曲線',
            'point_left': '左分岐器',
            'point_right': '右分岐器',
            'double_slip': 'ダブルクロス',
            'double_slip_x': 'ダブルスリップ',
            'crossing': '交差',
            'end': 'エンド'
        };
        
        return typeMap[type] || type;
    }

    // アプリケーションモードの設定を更新
    setAppMode(mode) {
        if (mode !== 'edit' && mode !== 'operation') {
            console.error('無効なモード:', mode);
            return;
        }
        
        // モードの設定
        this.appMode = mode;
        this.canvas.setAppMode(mode);
        
        // ボタンの見た目更新
        document.getElementById('editModeBtn').classList.toggle('active', mode === 'edit');
        document.getElementById('operationModeBtn').classList.toggle('active', mode === 'operation');
        
        // 編集ツールボタンの状態を更新
        this.updateEditToolButtons();
        
        // --- ここから表示設定の自動切替 ---
        if (mode === 'operation') {
            this.canvas.displayOptions.showGrid = false;
            this.canvas.displayOptions.showEndpoints = false;
            this.canvas.displayOptions.showConnections = false;
            this.canvas.displayOptions.showConnectionLabels = false;
        } else if (mode === 'edit') {
            this.canvas.displayOptions.showGrid = true;
            this.canvas.displayOptions.showEndpoints = true;
            this.canvas.displayOptions.showConnections = true;
            this.canvas.displayOptions.showConnectionLabels = true;
        }
        this.updateToggleButtonStates();
        this.canvas.draw();
        // --- ここまで追加 ---
        
        // 操作モードに切り替えるときはカーソルモードにリセット
        if (mode === 'operation') {
            this.drawMode = 'cursor';
            this.canvas.setDrawMode('cursor');
            document.getElementById('cursorBtn').classList.add('active');
            // ここでデフォルトのてこ・着点ボタンを自動追加（不要なので削除）
            // this.interlockingManager.ensureDefaultLeversAndButtons();
            // 選択対象をtrackに固定し、ラジオボタンもtrack側をcheckedにする
            this.selectionTarget = 'track';
            const selectTrackRadio = document.getElementById('selectTrackRadio');
            const selectElementRadio = document.getElementById('selectElementRadio');
            if (selectTrackRadio) selectTrackRadio.checked = true;
            if (selectElementRadio) selectElementRadio.checked = false;
            // 選択状態をリセット
            this.canvas.selectedTrack = null;
            this.canvas.selectedEndpoint = null;
            this.interlockingManager.editModeState.selectedElement = null;
            this.interlockingManager.editModeState.elementType = null;
            this.canvas.draw();
        }
        
        // ステータス表示の更新
        this.setStatusInfo(mode === 'edit' ? '編集モードに切り替えました。' : '操作モードに切り替えました。');
    }

    // ツールバーの状態を更新（既存のメソッドを削除）
    updateToolbarState(mode) {
        this.updateEditToolButtons();
    }

    // 初期モードの視覚的表示を設定
    updateAppModeButtons() {
        const editModeBtn = document.getElementById('editModeBtn');
        const operationModeBtn = document.getElementById('operationModeBtn');
        
        editModeBtn.classList.remove('active');
        operationModeBtn.classList.add('active');
    }

    // パーツボタンの選択状態を更新するヘルパーメソッド
    updateTrackPartButtonState(buttonId) {
        // すべてのパーツボタンを非アクティブに設定
        const partButtons = [
            'straight', 'point-left', 'point-right', 'double-slip', 'double-slipX', 'crossing', 'end', 
            'straightInsulation', 'crossInsulation',
            'signalLeverBtn', 'shuntingLeverBtn', 'markerLeverBtn', 'throughLeverBtn', 'destButtonBtn'
        ];
        partButtons.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.classList.remove('active');
            }
        });
        
        // 選択されたボタンをアクティブに設定
        const selectedBtn = document.getElementById(buttonId);
        if (selectedBtn) {
            selectedBtn.classList.add('active');
        }
        
        // 編集モードボタンが確実にアクティブになるようにする
        document.getElementById('editModeBtn').classList.add('active');
        document.getElementById('operationModeBtn').classList.remove('active');
    }

    // ポイントの配置モードを設定
    placePointTrack(direction, side) {
        // 編集モードでのみ処理
        if (this.appMode !== 'edit' || this.drawMode !== 'place') {
            this.setStatusInfo('配置モードに切り替えてください。');
            return;
        }
        
        // ボタンの選択状態を更新
        this.updateTrackPartButtonState('point-' + side);
        
        // ステータス表示
        this.setStatusInfo(`${side}分岐を配置します。`);
        
        // 新しいトラックを追加
        const trackId = this.trackManager.generateTrackId();
        const mousePos = this.getScaledMousePosition(this.canvas.lastMouseMoveEvent || 
            { clientX: this.canvas.trackCanvas.width / 2, clientY: this.canvas.trackCanvas.height / 2 });
        const snappedPos = this.snapToGrid(mousePos);
        const track = Track.createPreset(trackId, 'point_' + side, snappedPos.x, snappedPos.y);
        this.trackManager.addTrack(track);
        this.canvas.selectedTrack = track;
        this.canvas.isDragging = true;
        this.canvas.selectedEndpoint = null;
        this.canvas.draw();
        
        // マウス移動でパーツを追従させる
        const moveHandler = (e) => {
            const pos = this.getScaledMousePosition(e);
            const snappedPos = this.snapToGrid(pos);
            
            // 元の形状を維持しながら移動
            const offsetX = snappedPos.x - track.endpoints[0].x;
            const offsetY = snappedPos.y - track.endpoints[0].y;
            
            // 各端点を移動（相対位置を保持）
            track.endpoints.forEach(point => {
                point.x += offsetX;
                point.y += offsetY;
            });
            
            this.canvas.draw();
            // プレビュー描画（スケール・プレビュー用スタイルで）
            const ctx = this.canvas.trackCanvas.getContext('2d');
            ctx.save();
            ctx.globalAlpha = 0.5;
            ctx.strokeStyle = '#FF9800';
            ctx.setLineDash([6, 6]);
            this.canvas.drawTrack(track, this.canvas.scale, true);
            ctx.setLineDash([]);
            ctx.restore();
        };
        
        const upHandler = () => {
            // 配置時に各端点をグリッドにスナップ
            track.endpoints.forEach((point, index) => {
                const snappedPoint = this.canvas.snapToGrid(point);
                track.updateEndpoint(index, snappedPoint.x, snappedPoint.y);
            });
            
            this.canvas.trackCanvas.removeEventListener('mousemove', moveHandler);
            this.canvas.trackCanvas.removeEventListener('mouseup', upHandler);
            this.canvas.isDragging = false;
            this.canvas.selectedTrack = null;  // 選択状態をクリア
            
            // 描画モードを維持
            this.canvas.drawMode = 'place';
            
            this.canvas.draw();
            
            // 配置モードを維持したまま、次の配置のためのステータスメッセージを表示
            this.setStatusInfo(`${side}分岐を配置しました。配置を継続できます。`);
        };
        
        this.canvas.trackCanvas.addEventListener('mousemove', moveHandler);
        this.canvas.trackCanvas.addEventListener('mouseup', upHandler);
    }

    // 線路絶縁ボタンのイベントハンドラを追加
    placeInsulationTrack(type) {
        // 編集モードでのみ処理
        if (this.appMode !== 'edit') {
            this.setStatusInfo('編集モードに切り替えてください。');
            return;
        }
        
        // カーソルモードに設定
        this.setMode('cursor');
        
        // ボタンの選択状態を更新
        this.updateTrackPartButtonState(type);
        
        // ステータス表示
        const typeNameMap = {
            'straightInsulation': '直線絶縁',
            'crossInsulation': '絶縁クロス'
        };
        this.setStatusInfo(`${typeNameMap[type]}を配置します。`);
        
        // 新しいトラックを追加
        const trackId = this.trackManager.generateTrackId();
        const mousePos = this.canvas.getMousePosition(this.canvas.lastMouseMoveEvent || { clientX: this.canvas.trackCanvas.width / 2, clientY: this.canvas.trackCanvas.height / 2 });
        const snappedPos = this.canvas.snapToGrid(mousePos);
        const track = Track.createPreset(trackId, type, snappedPos.x, snappedPos.y);
        this.trackManager.addTrack(track);
        this.canvas.selectedTrack = track;
        this.canvas.isDragging = true;
        this.canvas.selectedEndpoint = null;
        this.canvas.draw();
        
        // マウス移動でパーツを追従させる
        const moveHandler = (e) => {
            const pos = this.canvas.getMousePosition(e);
            const snappedPos = this.canvas.snapToGrid(pos);
            
            // 元の形状を維持しながら移動
            const offsetX = snappedPos.x - track.endpoints[0].x;
            const offsetY = snappedPos.y - track.endpoints[0].y;
            
            // 各端点を移動（相対位置を保持）
            track.endpoints.forEach(point => {
                point.x += offsetX;
                point.y += offsetY;
            });
            
            this.canvas.draw();
            // プレビュー描画（スケール・プレビュー用スタイルで）
            const ctx = this.canvas.trackCanvas.getContext('2d');
            ctx.save();
            ctx.globalAlpha = 0.5;
            ctx.strokeStyle = '#FF9800';
            ctx.setLineDash([6, 6]);
            this.canvas.drawTrack(track, this.canvas.scale, true);
            ctx.setLineDash([]);
            ctx.restore();
        };
        
        const upHandler = () => {
            // 配置時に各端点をグリッドにスナップ
            track.endpoints.forEach((point, index) => {
                const snappedPoint = this.canvas.snapToGrid(point);
                track.updateEndpoint(index, snappedPoint.x, snappedPoint.y);
            });
            
            this.canvas.trackCanvas.removeEventListener('mousemove', moveHandler);
            this.canvas.trackCanvas.removeEventListener('mouseup', upHandler);
            this.canvas.isDragging = false;
            this.canvas.draw();
        };
        
        this.canvas.trackCanvas.addEventListener('mousemove', moveHandler);
        this.canvas.trackCanvas.addEventListener('mouseup', upHandler);
    }

    /**
     * キャンバスサイズ設定ダイアログを表示
     */
    showCanvasSizeDialog() {
        // 既存のダイアログがあれば削除
        const existingDialog = document.getElementById('canvas-size-dialog');
        if (existingDialog) {
            existingDialog.remove();
        }
        
        // ダイアログを作成
        const dialog = document.createElement('div');
        dialog.id = 'canvas-size-dialog';
        dialog.className = 'modal';
        
        // 現在のキャンバスサイズを取得
        const currentWidth = this.canvas.gridCanvas.width;
        const currentHeight = this.canvas.gridCanvas.height;
        
        // サイズプリセット
        const presets = [
            { name: '小 (1500x1000)', width: 1500, height: 1000 },
            { name: '中 (2000x1500)', width: 2000, height: 1500 },
            { name: '大 (3000x2000)', width: 3000, height: 2000 },
            { name: '特大 (4000x3000)', width: 4000, height: 3000 }
        ];
        
        // プリセットボタンのHTML生成
        const presetButtonsHtml = presets.map(preset => 
            `<button type="button" data-width="${preset.width}" data-height="${preset.height}">${preset.name}</button>`
        ).join('');
        
        dialog.innerHTML = `
            <div class="modal-content">
                <h2>キャンバスサイズの設定</h2>
                
                <div class="canvas-size-preset">
                    ${presetButtonsHtml}
                </div>
                
                <div class="canvas-size-dimensions">
                    <div class="input-group">
                        <label for="canvas-width">幅 (ピクセル):</label>
                        <input type="number" id="canvas-width" value="${currentWidth}" min="1000" max="5000" step="100">
                    </div>
                    <div class="input-group">
                        <label for="canvas-height">高さ (ピクセル):</label>
                        <input type="number" id="canvas-height" value="${currentHeight}" min="1000" max="5000" step="100">
                    </div>
                </div>
                
                <div class="modal-buttons">
                    <button id="canvas-size-cancel">キャンセル</button>
                    <button id="canvas-size-apply">適用</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(dialog);
        
        // プリセットボタンのイベント設定
        dialog.querySelectorAll('.canvas-size-preset button').forEach(button => {
            button.addEventListener('click', () => {
                const width = parseInt(button.dataset.width, 10);
                const height = parseInt(button.dataset.height, 10);
                
                document.getElementById('canvas-width').value = width;
                document.getElementById('canvas-height').value = height;
            });
        });
        
        // ボタンのイベント設定
        document.getElementById('canvas-size-cancel').addEventListener('click', () => {
            dialog.remove();
        });
        
        document.getElementById('canvas-size-apply').addEventListener('click', () => {
            const width = parseInt(document.getElementById('canvas-width').value, 10);
            const height = parseInt(document.getElementById('canvas-height').value, 10);
            
            if (width >= 1000 && height >= 1000) {
                this.canvas.setCanvasSize(width, height);
                this.setStatusInfo(`キャンバスサイズを ${width}x${height} に変更しました`);
                dialog.remove();
            } else {
                this.setStatusInfo('無効なキャンバスサイズです。1000px以上を指定してください。', true);
            }
        });
    }

    // テキストラベルを配置するメソッド
    placeTextLabel() {
        // 編集モードでのみ処理
        if (this.appMode !== 'edit') {
            this.setStatusInfo('編集モードに切り替えてください。');
            return;
        }
        
        // カーソルモードに設定
        this.setMode('cursor');
        
        // ボタンの選択状態を更新
        this.updateTrackPartButtonState('textLabel');
        
        // ステータス表示
        this.setStatusInfo('テキストラベルを配置します。画面上の配置したい位置をクリックしてください。');
        
        // 配置モード設定
        this.isPlacingElement = true;
        this.placingElementType = 'textLabel';
        
        // マウス位置を監視
        const canvasContainer = document.getElementById('canvas-container');
        
        // プレビュー用の要素を作成
        const previewLabel = document.createElement('div');
        previewLabel.className = 'text-label preview';
        previewLabel.textContent = 'テキスト';
        previewLabel.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        previewLabel.style.color = '#ffffff';
        previewLabel.style.padding = '4px';
        previewLabel.style.border = '1px dashed #ffffff';
        previewLabel.style.pointerEvents = 'none';
        previewLabel.style.position = 'absolute';
        previewLabel.style.zIndex = '1000';
        previewLabel.style.display = 'none';
        canvasContainer.appendChild(previewLabel);
        
        // マウス移動時のハンドラ
        const moveHandler = (e) => {
            const mousePos = this.canvas.getMousePosition(e);
            const gridPos = this.snapToGrid(mousePos);
            // 論理座標→画面座標変換
            const { left, top } = logicalToScreen(
                gridPos.x, gridPos.y,
                this.canvas.scale,
                this.canvas.scrollX || 0, this.canvas.scrollY || 0
            );
            previewLabel.style.left = `${left}px`;
            previewLabel.style.top = `${top}px`;
            previewLabel.style.display = 'flex';
        };
        
        // クリック時のハンドラ
        const clickHandler = (e) => {
            // 右クリックの場合はキャンセル
            if (e.button === 2) {
                cleanupEventListeners();
                this.cancelElementPlacement();
                return;
            }
            
            // 左クリックの場合は配置
            if (e.button === 0) {
                const mousePos = this.canvas.getMousePosition(e);
                const gridPos = this.snapToGrid(mousePos);
                
                // テキスト編集ダイアログを表示
                this.showTextLabelDialog(gridPos);
                
                // イベントリスナーをクリーンアップ
                cleanupEventListeners();
            }
        };
        
        // イベントリスナーのクリーンアップ関数
        const cleanupEventListeners = () => {
            canvasContainer.removeEventListener('mousemove', moveHandler);
            canvasContainer.removeEventListener('mousedown', clickHandler);
            
            // プレビュー要素を削除
            if (previewLabel && previewLabel.parentNode) {
                previewLabel.parentNode.removeChild(previewLabel);
            }
        };
        
        // イベントリスナーを設定
        canvasContainer.addEventListener('mousemove', moveHandler);
        canvasContainer.addEventListener('mousedown', clickHandler);
    }
    
    // テキストラベルのダイアログを表示
    showTextLabelDialog(position, existingLabel = null) {
        // 既存のダイアログがあれば削除
        const existingDialog = document.getElementById('text-label-dialog');
        if (existingDialog) {
            existingDialog.remove();
        }
        
        // ダイアログを作成
        const dialog = document.createElement('div');
        dialog.id = 'text-label-dialog';
        dialog.className = 'modal';
        
        // 既存ラベルがある場合はその値を取得、なければデフォルト値
        const labelText = existingLabel ? existingLabel.textContent : '';
        const fontFamily = existingLabel ? (existingLabel.style.fontFamily || '\'Meiryo UI\'') : '\'Meiryo UI\'';
        const fontSize = existingLabel ? parseInt(existingLabel.style.fontSize) || 14 : 14;
        const fontColor = existingLabel ? (existingLabel.style.color || '#ffffff') : '#ffffff';
        const fontWeight = existingLabel && existingLabel.style.fontWeight === 'bold' ? true : false;
        const fontItalic = existingLabel && existingLabel.style.fontStyle === 'italic' ? true : false;
        const backgroundColor = existingLabel ? (existingLabel.style.backgroundColor || 'rgba(0, 0, 0, 0)') : 'rgba(0, 0, 0, 0)';
        const borderColor = existingLabel ? (existingLabel.style.borderColor || 'rgba(255, 255, 255, 0)') : 'rgba(255, 255, 255, 0)';
        const borderWidth = existingLabel ? parseInt(existingLabel.style.borderWidth) || 0 : 0;
        const borderStyle = existingLabel ? (existingLabel.style.borderStyle || 'solid') : 'solid';
        const opacity = existingLabel ? parseFloat(existingLabel.style.opacity) || 1.0 : 1.0;
        
        // テキストの位置合わせ（存在しない場合はデフォルトで中央揃え）
        const hAlign = existingLabel ? (
            existingLabel.classList.contains('align-left') ? 'left' : 
            existingLabel.classList.contains('align-right') ? 'right' : 'center'
        ) : 'center';
        
        const vAlign = existingLabel ? (
            existingLabel.classList.contains('align-top') ? 'top' : 
            existingLabel.classList.contains('align-bottom') ? 'bottom' : 'middle'
        ) : 'middle';
        
        // フォントファミリーのオプション
        const fontFamilyOptions = [
            { value: 'Meiryo UI', label: 'Meiryo UI' },
            { value: 'Yu Gothic UI', label: 'Yu Gothic UI' },
            { value: 'MS UI Gothic', label: 'MS UI Gothic' },
            { value: 'Arial', label: 'Arial' },
            { value: 'Times New Roman', label: 'Times New Roman' },
            { value: 'Courier New', label: 'Courier New' },
            { value: 'monospace', label: 'モノスペース' }
        ].map(font => `<option value="${font.value}" ${fontFamily.includes(font.value) ? 'selected' : ''}>${font.label}</option>`).join('');
        
        // フォントサイズのオプション
        const fontSizeOptions = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48]
            .map(size => `<option value="${size}" ${fontSize === size ? 'selected' : ''}>${size}px</option>`)
            .join('');
        
        // 枠線スタイルのオプション
        const borderStyleOptions = [
            { value: 'solid', label: '実線' },
            { value: 'dashed', label: '破線' },
            { value: 'dotted', label: '点線' },
            { value: 'double', label: '二重線' }
        ].map(style => `<option value="${style.value}" ${borderStyle === style.value ? 'selected' : ''}>${style.label}</option>`).join('');
        
        dialog.innerHTML = `
            <div class="modal-content text-dialog">
                <h2>${existingLabel ? 'テキスト編集' : 'テキスト配置'}</h2>
                
                <div class="input-group">
                    <label for="text-content">テキスト:</label>
                    <textarea id="text-content" placeholder="ここにテキストを入力">${labelText}</textarea>
                </div>
                
                <h3>フォント設定</h3>
                <div class="font-settings">
                    <div class="input-group">
                        <label for="font-family">フォント:</label>
                        <select id="font-family">${fontFamilyOptions}</select>
                    </div>
                    <div class="input-group">
                        <label for="font-size">サイズ:</label>
                        <select id="font-size">${fontSizeOptions}</select>
                    </div>
                    <div class="input-group">
                        <label for="font-color">色:</label>
                        <input type="color" id="font-color" value="${fontColor}">
                    </div>
                </div>
                
                <div class="checkbox-container">
                    <input type="checkbox" id="font-bold" ${fontWeight ? 'checked' : ''}>
                    <label for="font-bold">太字</label>
                    <input type="checkbox" id="font-italic" ${fontItalic ? 'checked' : ''} style="margin-left: 15px;">
                    <label for="font-italic">斜体</label>
                </div>
                
                <h3>配置設定</h3>
                <div class="style-settings">
                    <div class="input-group">
                        <label for="text-align-h">水平位置:</label>
                        <select id="text-align-h">
                            <option value="left" ${hAlign === 'left' ? 'selected' : ''}>左揃え</option>
                            <option value="center" ${hAlign === 'center' ? 'selected' : ''}>中央揃え</option>
                            <option value="right" ${hAlign === 'right' ? 'selected' : ''}>右揃え</option>
                        </select>
                    </div>
                    <div class="input-group">
                        <label for="text-align-v">垂直位置:</label>
                        <select id="text-align-v">
                            <option value="top" ${vAlign === 'top' ? 'selected' : ''}>上揃え</option>
                            <option value="middle" ${vAlign === 'middle' ? 'selected' : ''}>中央揃え</option>
                            <option value="bottom" ${vAlign === 'bottom' ? 'selected' : ''}>下揃え</option>
                        </select>
                    </div>
                </div>
                
                <div class="checkbox-container" style="margin: 10px 0;">
                    <input type="checkbox" id="snap-to-grid" checked>
                    <label for="snap-to-grid">グリッドに吸着</label>
                </div>
                
                <h3>スタイル設定</h3>
                <div class="style-settings">
                    <div class="input-group">
                        <label for="bg-color">背景色:</label>
                        <input type="color" id="bg-color" value="${this.getRgbColor(backgroundColor)}">
                    </div>
                    <div class="input-group">
                        <label for="border-color">枠線色:</label>
                        <input type="color" id="border-color" value="${this.getRgbColor(borderColor)}">
                    </div>
                </div>
                
                <div class="style-settings">
                    <div class="input-group">
                        <label for="border-width">枠線太さ:</label>
                        <input type="range" id="border-width" min="0" max="10" value="${borderWidth}" class="range-slider">
                        <span id="border-width-value" class="range-value">${borderWidth}px</span>
                    </div>
                    <div class="input-group">
                        <label for="border-style">枠線スタイル:</label>
                        <select id="border-style">${borderStyleOptions}</select>
                    </div>
                </div>
                
                <div class="style-settings">
                    <div class="input-group">
                        <label for="opacity">透明度:</label>
                        <input type="range" id="opacity" min="0" max="100" value="${opacity * 100}" class="range-slider">
                        <span id="opacity-value" class="range-value">${Math.round(opacity * 100)}%</span>
                    </div>
                    <div class="input-group">
                        <label for="bg-opacity">背景透明度:</label>
                        <input type="range" id="bg-opacity" min="0" max="100" value="${this.getAlpha(backgroundColor) * 100}" class="range-slider">
                        <span id="bg-opacity-value" class="range-value">${Math.round(this.getAlpha(backgroundColor) * 100)}%</span>
                    </div>
                </div>
                
                <div class="modal-buttons">
                    <button id="text-cancel">キャンセル</button>
                    <button id="text-apply">${existingLabel ? '更新' : '配置'}</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(dialog);
        
        // スライダーの値表示を更新する関数
        const updateSliderValue = (sliderId, valueId, suffix = '') => {
            const slider = document.getElementById(sliderId);
            const valueDisplay = document.getElementById(valueId);
            
            slider.addEventListener('input', () => {
                valueDisplay.textContent = slider.value + suffix;
            });
        };
        
        // スライダーの値表示を設定
        updateSliderValue('border-width', 'border-width-value', 'px');
        updateSliderValue('opacity', 'opacity-value', '%');
        updateSliderValue('bg-opacity', 'bg-opacity-value', '%');
        
        // キャンセルボタンのイベント設定
        document.getElementById('text-cancel').addEventListener('click', () => {
            dialog.remove();
            this.cancelElementPlacement();
        });
        
        // 適用ボタンのイベント設定
        document.getElementById('text-apply').addEventListener('click', () => {
            const textContent = document.getElementById('text-content').value.trim();
            
            if (textContent) {
                const fontFamily = document.getElementById('font-family').value;
                const fontSize = document.getElementById('font-size').value;
                const fontColor = document.getElementById('font-color').value;
                const fontBold = document.getElementById('font-bold').checked;
                const fontItalic = document.getElementById('font-italic').checked;
                
                // 新たなスタイル設定を取得
                const bgColor = document.getElementById('bg-color').value;
                const bgOpacity = document.getElementById('bg-opacity').value / 100;
                const borderColor = document.getElementById('border-color').value;
                const borderWidth = document.getElementById('border-width').value;
                const borderStyle = document.getElementById('border-style').value;
                const opacity = document.getElementById('opacity').value / 100;
                
                // テキスト配置の設定を取得
                const hAlign = document.getElementById('text-align-h').value;
                const vAlign = document.getElementById('text-align-v').value;
                const snapToGrid = document.getElementById('snap-to-grid').checked;
                
                // カラー値をRGBA形式に変換
                const bgColorRgba = this.hexToRgba(bgColor, bgOpacity);
                const borderColorRgba = this.hexToRgba(borderColor, 1.0);
                
                // スタイル設定をオブジェクトに格納
                const textStyle = {
                    fontFamily,
                    fontSize: `${fontSize}px`,
                    color: fontColor,
                    fontWeight: fontBold ? 'bold' : 'normal',
                    fontStyle: fontItalic ? 'italic' : 'normal',
                    backgroundColor: bgColorRgba,
                    borderColor: borderColorRgba,
                    borderWidth: `${borderWidth}px`,
                    borderStyle,
                    opacity
                };
                
                // グリッドに吸着する場合、位置を調整
                if (snapToGrid) {
                    position = this.snapToGrid(position);
                }
                
                if (existingLabel) {
                    // 既存ラベルの更新
                    existingLabel.textContent = textContent;
                    Object.assign(existingLabel.style, textStyle);
                    existingLabel.dataset.scale = 1; // スケール情報を保存
                    
                    // 位置揃えのクラスを更新
                    existingLabel.classList.remove('align-left', 'align-right', 'align-top', 'align-bottom');
                    if (hAlign !== 'center') existingLabel.classList.add(`align-${hAlign}`);
                    if (vAlign !== 'middle') existingLabel.classList.add(`align-${vAlign}`);
                    
                    // グリッドに吸着する場合、位置を調整
                    if (snapToGrid) {
                        const x = parseInt(existingLabel.dataset.x);
                        const y = parseInt(existingLabel.dataset.y);
                        const snappedPos = this.snapToGrid({x, y});
                        
                        existingLabel.style.left = `${snappedPos.x}px`;
                        existingLabel.style.top = `${snappedPos.y}px`;
                        existingLabel.dataset.x = snappedPos.x;
                        existingLabel.dataset.y = snappedPos.y;
                    }
                    
                    this.setStatusInfo('テキストラベルを更新しました。');
                } else {
                    // 新規ラベルの作成（位置揃えの設定を渡す）
                    const textConfig = { hAlign, vAlign, snapToGrid };
                    this.createTextLabel(position, textContent, textStyle, textConfig);
                    this.setStatusInfo('テキストラベルを配置しました。');
                }
            } else {
                // テキストが空の場合は既存ラベルを削除
                if (existingLabel && existingLabel.parentNode) {
                    existingLabel.parentNode.removeChild(existingLabel);
                    this.setStatusInfo('テキストラベルを削除しました。');
                } else {
                    this.setStatusInfo('テキストが入力されていません。', true);
                    return;
                }
            }
            
            dialog.remove();
            this.updateTrackPartButtonState(null);
        });
    }
    
    // 位置をグリッドに吸着させる
    snapToGrid(position) {
        if (!position || typeof position !== 'object' || 
            isNaN(position.x) || isNaN(position.y)) {
            return { x: 0, y: 0 };
        }
        
        const gridSize = this.canvas?.gridSize || 20;
        return {
            x: Math.round(position.x / gridSize) * gridSize,
            y: Math.round(position.y / gridSize) * gridSize
        };
    }
    
    // HEXカラーをRGBA形式に変換
    hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    
    // RGB形式の色をHEX形式に変換
    getRgbColor(rgba) {
        if (!rgba || rgba === 'transparent' || rgba === 'rgba(255, 255, 255, 0)') {
            return '#ffffff';
        }
        
        // rgb(r, g, b) または rgba(r, g, b, a) 形式かチェック
        const rgbMatches = rgba.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i);
        const rgbaMatches = rgba.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\)$/i);
        
        if (rgbMatches) {
            const r = parseInt(rgbMatches[1]).toString(16).padStart(2, '0');
            const g = parseInt(rgbMatches[2]).toString(16).padStart(2, '0');
            const b = parseInt(rgbMatches[3]).toString(16).padStart(2, '0');
            return `#${r}${g}${b}`;
        } else if (rgbaMatches) {
            const r = parseInt(rgbaMatches[1]).toString(16).padStart(2, '0');
            const g = parseInt(rgbaMatches[2]).toString(16).padStart(2, '0');
            const b = parseInt(rgbaMatches[3]).toString(16).padStart(2, '0');
            return `#${r}${g}${b}`;
        }
        
        // 既にHEX形式の場合はそのまま返す
        if (rgba.startsWith('#')) {
            return rgba;
        }
        
        // それ以外の場合はデフォルト値を返す
        return '#ffffff';
    }
    
    // 背景色からアルファ値を取得
    getAlpha(rgba) {
        if (!rgba || rgba === 'transparent' || rgba === 'rgba(255, 255, 255, 0)') {
            return 0;
        }
        
        const matches = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/i);
        if (matches && matches[4]) {
            return parseFloat(matches[4]);
        }
        
        return 1.0; // アルファ値が指定されていない場合は不透明と判断
    }
    
    // テキストラベルを作成して配置
    createTextLabel(position, text, style, config = {}) {
        const canvasContainer = document.getElementById('canvas-container');
        
        // 位置の検証（NaN対策）
        const safePosition = {
            x: isNaN(position.x) ? 0 : position.x,
            y: isNaN(position.y) ? 0 : position.y
        };
        
        // テキストラベル要素を作成
        const label = document.createElement('div');
        label.className = 'text-label';
        label.textContent = text;
        label.id = `text_${Date.now()}`;
        
        // 位置合わせのクラスを追加
        const { hAlign = 'center', vAlign = 'middle' } = config;
        if (hAlign !== 'center') label.classList.add(`align-${hAlign}`);
        if (vAlign !== 'middle') label.classList.add(`align-${vAlign}`);
        
        // スタイルを設定
        Object.assign(label.style, style);
        
        // グリッド吸着
        const snappedPosition = config.snapToGrid ? this.snapToGrid(safePosition) : safePosition;
        
        // 位置を設定（キャンバスコンテナ内での相対位置）
        label.style.left = `${snappedPosition.x}px`;
        label.style.top = `${snappedPosition.y}px`;
        
        // 拡大縮小情報を保存
        label.dataset.scale = 1;
        label.dataset.x = snappedPosition.x;
        label.dataset.y = snappedPosition.y;
        
        // キャンバスコンテナに追加
        canvasContainer.appendChild(label);
        
        // ドラッグ機能を追加
        this.makeTextLabelDraggable(label, config.snapToGrid);
        
        // ダブルクリックで編集できるようにする
        label.addEventListener('dblclick', (e) => {
            // ラベルの現在位置を取得
            const position = {
                x: parseInt(label.dataset.x) || 0,
                y: parseInt(label.dataset.y) || 0
            };
            
            this.showTextLabelDialog(position, label);
            e.stopPropagation();
        });
        
        // 右クリックメニュー
        label.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            
            // 既存のコンテキストメニューを削除
            const existingMenu = document.getElementById('text-context-menu');
            if (existingMenu) {
                existingMenu.remove();
            }
            
            // コンテキストメニューを作成
            const menu = document.createElement('div');
            menu.id = 'text-context-menu';
            menu.style.position = 'absolute';
            menu.style.left = `${e.pageX}px`;
            menu.style.top = `${e.pageY}px`;
            menu.style.backgroundColor = 'white';
            menu.style.border = '1px solid #ccc';
            menu.style.boxShadow = '2px 2px 5px rgba(0,0,0,0.2)';
            menu.style.padding = '5px 0';
            menu.style.zIndex = '1000';
            
            // メニュー項目
            const items = [
                { text: '編集', action: () => {
                    const pos = {
                        x: parseInt(label.dataset.x) || 0, 
                        y: parseInt(label.dataset.y) || 0
                    };
                    this.showTextLabelDialog(pos, label);
                }},
                { text: '最前面へ', action: () => { label.style.zIndex = '100'; } },
                { text: '最背面へ', action: () => { label.style.zIndex = '1'; } },
                { text: '削除', action: () => { label.remove(); } }
            ];
            
            items.forEach(item => {
                const menuItem = document.createElement('div');
                menuItem.textContent = item.text;
                menuItem.style.padding = '5px 20px';
                menuItem.style.cursor = 'pointer';
                
                menuItem.addEventListener('mouseover', () => {
                    menuItem.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--primary-light');
                });
                
                menuItem.addEventListener('mouseout', () => {
                    menuItem.style.backgroundColor = 'transparent';
                });
                
                menuItem.addEventListener('click', () => {
                    item.action();
                    menu.remove();
                });
                
                menu.appendChild(menuItem);
            });
            
            document.body.appendChild(menu);
            
            // メニュー以外をクリックしたら閉じる
            document.addEventListener('click', () => {
                if (menu && menu.parentNode) {
                    menu.remove();
                }
            }, { once: true });
            
            e.stopPropagation();
        });
        
        // キャンバスの拡大縮小イベントに対応
        this.setupTextLabelScaling(label);
        
        return label;
    }
    
    // テキストラベルの拡大縮小イベントを設定
    setupTextLabelScaling(label) {
        const canvasContainer = document.getElementById('canvas-container');
        
        // ホイールイベントを監視
        canvasContainer.addEventListener('wheel', (e) => {
            // ズーム比率の取得 (Canvas クラスからの参照が必要)
            if (this.canvas && this.canvas.scale) {
                this.updateTextLabelScale(label, this.canvas.scale);
            }
        });
        
        // ズームボタンがあれば監視
        const zoomInBtn = document.getElementById('zoomInBtn');
        const zoomOutBtn = document.getElementById('zoomOutBtn');
        
        if (zoomInBtn) {
            zoomInBtn.addEventListener('click', () => {
                if (this.canvas && this.canvas.scale) {
                    this.updateTextLabelScale(label, this.canvas.scale);
                }
            });
        }
        
        if (zoomOutBtn) {
            zoomOutBtn.addEventListener('click', () => {
                if (this.canvas && this.canvas.scale) {
                    this.updateTextLabelScale(label, this.canvas.scale);
                }
            });
        }
        
        // 初期スケール適用
        if (this.canvas && this.canvas.scale) {
            this.updateTextLabelScale(label, this.canvas.scale);
        }
    }
    
    // テキストラベルのスケールを更新
    updateTextLabelScale(label, scale) {
        label.dataset.scale = scale;
        // 変換行列を使って拡大縮小
        label.style.transform = `scale(${scale})`;
        // データ属性に保存されている論理座標を画面座標に変換
        const x = parseInt(label.dataset.x);
        const y = parseInt(label.dataset.y);
        const { left, top } = logicalToScreen(
            x, y,
            scale,
            this.canvas.scrollX || 0, this.canvas.scrollY || 0
        );
        label.style.left = `${left}px`;
        label.style.top = `${top}px`;
    }
    
    // テキストラベルの位置を更新（すべてのラベルに適用）
    updateAllTextLabelsScale(scale) {
        document.querySelectorAll('.text-label').forEach(label => {
            this.updateTextLabelScale(label, scale);
        });
    }
    
    // テキストラベルをドラッグ可能にする
    makeTextLabelDraggable(element, snapToGrid = true) {
        let isDragging = false;
        let offsetX = 0;
        let offsetY = 0;
        
        // データ属性の初期化（NaN防止）
        if (!element.dataset.x || isNaN(parseInt(element.dataset.x))) {
            const rect = element.getBoundingClientRect();
            const canvasContainer = document.getElementById('canvas-container');
            const containerRect = canvasContainer.getBoundingClientRect();
            element.dataset.x = rect.left - containerRect.left + canvasContainer.scrollLeft;
            element.dataset.y = rect.top - containerRect.top + canvasContainer.scrollTop;
        }
        
        // ドラッグ開始時
        element.addEventListener('mousedown', (e) => {
            // 左クリックのみ処理
            if (e.button !== 0) return;
            
            // 他のラベルの選択状態を解除
            document.querySelectorAll('.text-label').forEach(label => {
                if (label !== element) {
                    label.classList.remove('selected');
                }
            });
            
            // このラベルを選択状態に
            element.classList.add('selected');
            
            isDragging = true;
            
            // クリック位置とラベル位置のオフセットを計算
            const rect = element.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            
            // ドラッグ中のスタイル
            element.style.cursor = 'grabbing';
            element.style.opacity = '0.8'; // 半透明にして移動中であることを示す
            
            // プロパティパネルを更新
            this.updateTextLabelProperties(element);
            
            e.preventDefault();
            e.stopPropagation();
        });
        
        // ドラッグ中
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const canvasContainer = document.getElementById('canvas-container');
            const containerRect = canvasContainer.getBoundingClientRect();
            const scale = parseFloat(element.dataset.scale) || 1;
            let left = (e.clientX - containerRect.left - offsetX * scale + canvasContainer.scrollLeft) / scale * scale;
            let top = (e.clientY - containerRect.top - offsetY * scale + canvasContainer.scrollTop) / scale * scale;
            if (isNaN(left) || isNaN(top)) {
                left = e.clientX - containerRect.left + canvasContainer.scrollLeft;
                top = e.clientY - containerRect.top + canvasContainer.scrollTop;
            }
            if (snapToGrid) {
                const gridSize = this.canvas.gridSize || 20;
                left = Math.round(left / gridSize) * gridSize;
                top = Math.round(top / gridSize) * gridSize;
            }
            // 論理座標→画面座標変換
            const { left: screenLeft, top: screenTop } = logicalToScreen(
                left, top,
                scale,
                this.canvas.scrollX || 0, this.canvas.scrollY || 0
            );
            element.style.left = `${screenLeft}px`;
            element.style.top = `${screenTop}px`;
            element.dataset.x = left;
            element.dataset.y = top;
        });
        
        // ドラッグ終了時
        document.addEventListener('mouseup', () => {
            if (isDragging) {
                // スタイルを元に戻す
                element.style.cursor = 'move';
                element.style.opacity = '1';
                
                isDragging = false;
                
                // ドラッグ終了時に選択状態を解除（少し遅延させる）
                setTimeout(() => {
                    element.classList.remove('selected');
                }, 300);
            }
        });
        
        // マウスがキャンバス外に出た場合
        document.addEventListener('mouseleave', () => {
            if (isDragging) {
                // スタイルを元に戻す
                element.style.cursor = 'move';
                element.style.opacity = '1';
                
                isDragging = false;
                
                // マウスがキャンバス外に出た場合も選択状態を解除
                setTimeout(() => {
                    element.classList.remove('selected');
                }, 300);
            }
        });
        
        // 通常時のホバースタイル
        element.addEventListener('mouseover', () => {
            if (!isDragging) {
                element.style.cursor = 'move';
            }
        });
        
        // キャンバスコンテナのクリックでも選択解除
        const canvasContainer = document.getElementById('canvas-container');
        canvasContainer.addEventListener('click', (e) => {
            // ラベル以外の場所をクリックした場合、全てのラベルの選択状態を解除
            if (e.target === canvasContainer || e.target.tagName === 'CANVAS') {
                document.querySelectorAll('.text-label').forEach(label => {
                    label.classList.remove('selected');
                });
            }
        });
    }

    /**
     * 選択されたトラックのプロパティを更新
     * @param {Track} track 選択されたトラック
     */
    updateSelectedProperties(element, type = 'track', options = {}) {
        const propertiesContainer = document.getElementById('selected-properties');
        if (!propertiesContainer) return;

        // 要素が選択されていない場合
        if (!element) {
            propertiesContainer.innerHTML = '<p>パーツを選択してください</p>';
            return;
        }

        // 要素のタイプに応じてプロパティHTMLを生成
        let propertiesHTML = '';
        switch (type) {
            case 'track':
                propertiesHTML = this.createTrackPropertiesHTML(element);
                break;
            case 'lever':
                propertiesHTML = this.createLeverPropertiesHTML(element);
                break;
            case 'button':
                propertiesHTML = this.createButtonPropertiesHTML(element);
                break;
            case 'insulation':
                propertiesHTML = this.createInsulationPropertiesHTML(element);
                break;
            default:
                propertiesHTML = '<p>未対応の要素タイプです</p>';
                break;
        }

        // プロパティHTMLを設定
        propertiesContainer.innerHTML = propertiesHTML;

        // イベントリスナーを設定
        this.setupPropertyEventListeners(element, type);
    }

    /**
     * 線路パーツのプロパティHTML生成
     */
    createTrackPropertiesHTML(track) {
        return `
            <div class="property-group">
                <h3>線路プロパティ</h3>
                <div class="property-item">
                    <label>ID:</label>
                    <span>${track.id}</span>
                </div>
                <div class="property-item">
                    <label>名称:</label>
                    <input type="text" class="track-name" value="${track.name}" data-track-id="${track.id}">
                </div>
                <div class="property-item">
                    <label>タイプ:</label>
                    <span>${this.getTrackTypeName(track.type)}</span>
                </div>
                ${track.isPoint ? `
                <div class="property-item">
                    <label>DCCアドレス:</label>
                    <input type="number" class="dcc-address" value="${track.dccAddress}" min="0" max="999">
                    <label class="checkbox-label">
                        <input type="checkbox" class="invert-dcc" ${track.invertDcc ? 'checked' : ''}>
                        出力反転
                    </label>
                </div>
                ` : ''}
            </div>
        `;
    }

    /**
     * てこのプロパティHTML生成
     */
    createLeverPropertiesHTML(lever) {
        return `
            <div class="property-group">
                <h3>てこプロパティ</h3>
                <div class="property-item">
                    <label>ID:</label>
                    <span>${lever.id}</span>
                </div>
                <div class="property-item">
                    <label>名称:</label>
                    <input type="text" class="lever-name" value="${lever.name}" data-lever-id="${lever.id}">
                </div>
                <div class="property-item">
                    <label>タイプ:</label>
                    <span>${this.getLeverTypeName(lever.type)}</span>
                </div>
                <div class="property-item">
                    <label>設置線路:</label>
                    <span class="track-id">${lever.trackId || '未設定'}</span>
                    <button class="reassign-track">変更</button>
                </div>
            </div>
        `;
    }

    /**
     * 着点ボタンのプロパティHTML生成
     */
    createButtonPropertiesHTML(button) {
        return `
            <div class="property-group">
                <h3>ボタンプロパティ</h3>
                <div class="property-item">
                    <label>ID:</label>
                    <span>${button.id}</span>
                </div>
                <div class="property-item">
                    <label>名称:</label>
                    <input type="text" class="button-name" value="${button.name}" data-button-id="${button.id}">
                </div>
                <div class="property-item">
                    <label>設置線路:</label>
                    <span class="track-id">${button.trackId || '未設定'}</span>
                    <button class="reassign-track">変更</button>
                </div>
            </div>
        `;
    }

    /**
     * 線路絶縁のプロパティHTML生成
     */
    createInsulationPropertiesHTML(insulation) {
        return `
            <div class="property-group">
                <h3>絶縁プロパティ</h3>
                <div class="property-item">
                    <label>ID:</label>
                    <span>${insulation.id}</span>
                </div>
                <div class="property-item">
                    <label>名称:</label>
                    <input type="text" class="insulation-name" value="${insulation.name}" data-insulation-id="${insulation.id}">
                </div>
                <div class="property-item">
                    <label>タイプ:</label>
                    <span>${this.getInsulationTypeName(insulation.type)}</span>
                </div>
                <div class="property-item">
                    <label>設置線路:</label>
                    <span class="track-id">${insulation.trackId || '未設定'}</span>
                    <button class="reassign-track">変更</button>
                </div>
            </div>
        `;
    }

    /**
     * プロパティパネルのイベントリスナー設定
     */
    setupPropertyEventListeners(element, type) {
        const container = this.selectedProperties;

        // 名前変更イベントリスナー
        const nameInput = container.querySelector(`.${type}-name`);
        if (nameInput) {
            nameInput.addEventListener('change', (e) => {
                const newName = e.target.value.trim();
                if (newName) {
                    element.name = newName;
                    this.canvas.draw();
                }
            });
        }

        // DCCアドレス変更（線路の場合）
        if (type === 'track') {
            const dccInput = container.querySelector('.dcc-address');
            if (dccInput) {
                dccInput.addEventListener('change', (e) => {
                    const address = parseInt(e.target.value);
                    if (!isNaN(address) && address >= 0) {
                        element.dccAddress = address;
                    }
                });
            }

            const invertDcc = container.querySelector('.invert-dcc');
            if (invertDcc) {
                invertDcc.addEventListener('change', (e) => {
                    element.invertDcc = e.target.checked;
                });
            }
        }

        // 線路再割り当てボタン
        const reassignBtn = container.querySelector('.reassign-track');
        if (reassignBtn) {
            reassignBtn.addEventListener('click', () => {
                this.startTrackReassignment(element, type);
            });
        }
    }

    // 線路タイプの表示名を取得
    getTrackTypeName(type) {
        return Track.prototype.getTrackTypeName(type);
    }

    // てこタイプの表示名を取得
    getLeverTypeName(type) {
        const typeNames = {
            'signal': '信号てこ',
            'shunting_signal': '入換てこ',
            'shunting_marker': '標識てこ',
            'through_lever': '開通てこ'
        };
        return typeNames[type] || type;
    }

    // 絶縁タイプの表示名を取得
    getInsulationTypeName(type) {
        const typeNames = {
            'straight': '直線絶縁',
            'cross': '絶縁クロス'
        };
        return typeNames[type] || type;
    }

    /**
     * 線路の再設定を開始
     */
    startTrackReassignment(element, type) {
        this.setStatusInfo('関連付ける線路をクリックしてください。');
        // 線路選択モード中は強制的に線路のみ選択
        const prevSelectionTarget = this.selectionTarget;
        this.selectionTarget = 'track';
        document.getElementById('selectTrackRadio').checked = true;
        const trackSelectHandler = (e) => {
            const mousePos = this.canvas.getMousePosition(e);
            const clickedTrack = this.canvas.findTrackAtPosition(mousePos.x, mousePos.y);
            if (clickedTrack) {
                if (type === 'insulation') {
                    if (!element.trackSegments) element.trackSegments = [];
                    if (element.trackSegments.length === 0) {
                        element.trackSegments.push({ trackId: clickedTrack.id, circuitId: null });
                    } else {
                        element.trackSegments[0].trackId = clickedTrack.id;
                    }
                } else {
                    element.trackId = clickedTrack.id;
                }
                this.updateSelectedProperties(element, type);
                this.setStatusInfo('線路の関連付けが完了しました。');
                this.canvas.trackCanvas.removeEventListener('click', trackSelectHandler);
                // 元の選択対象に戻す
                this.selectionTarget = prevSelectionTarget;
                if (prevSelectionTarget === 'track') {
                    document.getElementById('selectTrackRadio').checked = true;
                } else {
                    document.getElementById('selectElementRadio').checked = true;
                }
            }
        };
        this.canvas.trackCanvas.addEventListener('click', trackSelectHandler);
    }

    // --- ここから追加 ---
    /**
     * マウスイベントからキャンバス座標（スケール・スクロール考慮済み）を取得
     * @param {MouseEvent} e
     * @returns {{x: number, y: number}}
     */
    getScaledMousePosition(e) {
        return this.canvas.getMousePosition(e);
    }
    // --- ここまで追加 ---

    // TrackManagerのリスナー用メソッド
    onTracksChanged() {
        this.updatePointsList();
    }
}

// アプリケーションの初期化
document.addEventListener('DOMContentLoaded', () => {
    // メインアプリケーションの初期化
    window.app = new App('gridCanvas', 'trackCanvas');
});

// Rキーで仮パーツを回転
document.addEventListener('keydown', (e) => {
    if (this.appMode === 'edit' && this.drawMode === 'place' && this.placingPartType && this.placingPartType !== 'straight' && this._previewPlacingTrack) {
        if (e.key === 'r' || e.key === 'R') {
            // 90度回転（時計回り）
            this._previewPlacingTrackRotation = (this._previewPlacingTrackRotation || 0) + Math.PI / 2;
            this.canvas.draw();
        } else if ((e.key === 'R' || e.key === 'r') && e.shiftKey) {
            // 逆回転（Shift+R）
            this._previewPlacingTrackRotation = (this._previewPlacingTrackRotation || 0) - Math.PI / 2;
            this.canvas.draw();
        }
    }
});

// 論理座標→画面座標変換関数
function logicalToScreen(x, y, scale, scrollX, scrollY) {
    return {
        left: x * scale - scrollX,
        top:  y * scale - scrollY
    };
}

// ... existing code ...
// --- ここから追加 ---
// DOMContentLoaded後の初期化に追加
const origInit = window.onload || (()=>{});
document.addEventListener('DOMContentLoaded', () => {
    origInit();
    // ポイント一覧モーダルの開閉
    const openBtn = document.getElementById('openPointsModalBtn');
    const modal = document.getElementById('pointsModal');
    const closeBtn = document.getElementById('closePointsModalBtn');
    if (openBtn && modal && closeBtn) {
        openBtn.addEventListener('click', () => {
            window.app.renderPointsModalList();
            modal.style.display = 'flex';
        });
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }
});

// ポイント一覧モーダルの描画
App.prototype.renderPointsModalList = function() {
    const container = document.getElementById('points-modal-list');
    if (!container) return;
    // ポイント・ダブルクロス・ダブルスリップも含める
    const points = Array.from(this.trackManager.tracks.values()).filter(track =>
        (track.type && track.type.startsWith('point_')) ||
        track.type === 'double_cross' ||
        track.type === 'double_slip_x'
    );
    container.innerHTML = '';
    if (points.length === 0) {
        container.innerHTML = '<p>ポイントがありません</p>';
        return;
    }
    points.forEach((track, index) => {
        const isInverted = track && track.invertDcc;
        const displayDirection = isInverted ? (track.pointDirection === 'normal' ? 'reverse' : 'normal') : track.pointDirection;
        const address = track ? track.dccAddress : '';
        const item = document.createElement('div');
        item.className = 'point-item';
        item.style.marginBottom = '8px';
        item.innerHTML = `
            <div class="point-info">
                <span class="point-label">${track.type === 'double_cross' ? 'ダブルクロス' : track.type === 'double_slip_x' ? 'ダブルスリップ' : `ポイント #${index + 1}`}</span>
                <span class="point-address">アドレス: <input type="number" class="address-input" value="${address}" min="0" max="2044" style="width:60px;"></span>
            </div>
            <div class="point-direction">
                <div class="direction-indicator ${displayDirection === 'normal' ? 'direction-normal' : 'direction-reverse'}"></div>
                <span>${displayDirection === 'normal' ? '直進' : '分岐'}${isInverted ? ' (DCC反転)' : ''}</span>
            </div>
            <div class="point-controls" style="margin-top:4px;">
                <label style="margin-right:8px;">
                    <input type="checkbox" class="invert-dcc-checkbox" ${isInverted ? 'checked' : ''}> DCC反転
                </label>
                <button class="switch-button">ポイント切替</button>
            </div>
        `;
        // アドレス入力
        const addrInput = item.querySelector('.address-input');
        addrInput.addEventListener('change', () => {
            const newAddress = parseInt(addrInput.value, 10);
            if (track) track.dccAddress = newAddress;
            this.renderPointsModalList();
        });
        // 反転チェック
        const invertChk = item.querySelector('.invert-dcc-checkbox');
        invertChk.addEventListener('change', () => {
            if (track) track.invertDcc = invertChk.checked;
            this.renderPointsModalList();
        });
        // 切替ボタン
        const switchBtn = item.querySelector('.switch-button');
        switchBtn.addEventListener('click', async () => {
            if (!track) return;
            const newDir = track.pointDirection === 'normal' ? 'reverse' : 'normal';
            await this.trackManager.switchPoint(track.id, newDir);
            this.renderPointsModalList();
            this.canvas.draw();
        });
        container.appendChild(item);
    });
};
// --- ここまで追加 ---

// ... existing code ...
// プロパティパネルのポイント表示を「配置直後のみ・完了で消す」ようにするには、
// updateSelectedProperties内で「完了」ボタンを追加し、押されたらパネルを空にする
// ↓この部分を削除
// const origUpdateSelectedProperties = App.prototype.updateSelectedProperties;
// App.prototype.updateSelectedProperties = function(track, type = 'track') {
//     origUpdateSelectedProperties.call(this, track, type);
//     if (!track) return;
//     if (type === 'track' && track.type && track.type.startsWith('point_')) {
//         const propertiesContainer = document.getElementById('selected-properties');
//         if (propertiesContainer) {
//             const doneBtn = document.createElement('button');
//             doneBtn.textContent = '完了';
//             doneBtn.className = 'property-action-btn';
//             doneBtn.style.marginTop = '12px';
//             doneBtn.addEventListener('click', () => {
//                 propertiesContainer.innerHTML = '<p>パーツを選択してください</p>';
//             });
//             propertiesContainer.appendChild(doneBtn);
//         }
//     }
// };
// ... existing code ...
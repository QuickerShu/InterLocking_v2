/**
 * 電子連動アプリの発点てこ・着点ボタン・線路絶縁の実装
 * 発点てこ、着点ボタン、および線路絶縁の機能を提供する
 */

// 定数定義
let LEVER_TYPE_CODES = {
    SIGNAL: 'signal',           // 信号てこ(本線用)
    SHUNTING_SIGNAL: 'shunting_signal', // 入換信号てこ(構内入換用、防護区間あり)
    SHUNTING_MARKER: 'shunting_marker', // 入換標識てこ(構内入換用、防護区間なし)
    THROUGH_LEVER: 'through_lever'    // 開通てこ(過走防護用)
};

let LEVER_COLORS = {
    [LEVER_TYPE_CODES.SIGNAL]: '#FF0000',          // 赤色
    [LEVER_TYPE_CODES.SHUNTING_SIGNAL]: '#FFFFFF', // 白色
    [LEVER_TYPE_CODES.SHUNTING_MARKER]: '#00FF00', // 緑色
    [LEVER_TYPE_CODES.THROUGH_LEVER]: '#FFFF00'    // 黄色
};

let LEVER_STATES = {
    NEUTRAL: 'neutral',  // 中立位置
    LEFT: 'left',        // 左方向
    RIGHT: 'right'       // 右方向
};

let BUTTON_STATES = {
    NORMAL: 'normal',         // 通常状態
    SELECTABLE: 'selectable', // 選択可能状態
    SELECTED: 'selected',     // 選択中
    ACTIVE: 'active'          // 進路開通中
};

let BUTTON_COLORS = {
    [BUTTON_STATES.NORMAL]: '#EBEBEB',     // グレー
    [BUTTON_STATES.SELECTABLE]: '#0000FF', // 青色
    [BUTTON_STATES.SELECTED]: '#00FFFF',   // 水色
    [BUTTON_STATES.ACTIVE]: '#FFFF00'      // 黄色
};

let INSULATION_TYPES = {
    STRAIGHT: 'straight'   // 直線絶縁
};

class InterlockingElement {
    constructor(type, x, y) {
        this.id = crypto.randomUUID();
        this.type = type;
        this.name = `${this.getElementTypeName(type)}${this.id.substring(0, 4)}`; // 要素名称
        this.x = x;
        this.y = y;
    }

    // 要素タイプから表示名を取得
    getElementTypeName(type) {
        const typeNames = {
            'signalLever': '信号てこ',
            'shuntingLever': '入換てこ',
            'markerLever': '標識てこ',
            'throughLever': '開通てこ',
            'destButton': '着点ボタン',
            'straightInsulation': '直線絶縁',
            'crossInsulation': '絶縁クロス'
        };
        return typeNames[type] || type;
    }

    createElement() {
        const element = document.createElement('div');
        element.className = 'interlocking-element';
        element.dataset.elementId = this.id;
        element.dataset.elementType = this.type;

        // クリックイベントの追加
        element.addEventListener('click', (e) => {
            if (routeManager.currentMode === 'auto' || routeManager.currentMode === 'manual') {
                routeManager.handleElementClick(this.id, this.type);
                e.stopPropagation();
            }
        });

        return element;
    }

    toJSON() {
        return {
            id: this.id,
            type: this.type,
            name: this.name,
            x: this.x,
            y: this.y
        };
    }

    static fromJSON(data) {
        const element = new InterlockingElement(data.type, data.x, data.y);
        element.id = data.id;
        element.name = data.name || element.name; // 名前がない場合はデフォルト値を使用
        return element;
    }
}

class SignalLever extends InterlockingElement {
    constructor(x, y) {
        super('signalLever', x, y);
    }
}

class ShuntingLever extends InterlockingElement {
    constructor(x, y) {
        super('shuntingLever', x, y);
    }
}

class MarkerLever extends InterlockingElement {
    constructor(x, y) {
        super('markerLever', x, y);
    }
}

class ThroughLever extends InterlockingElement {
    constructor(x, y) {
        super('throughLever', x, y);
    }
}

/**
 * 着点ボタンクラス
 * 進路の終点となるボタンを表現する
 */
class DestinationButton extends InterlockingElement {
    /**
     * 着点ボタンのコンストラクタ
     * @param {string} id - ボタンの一意の識別子
     * @param {Object} position - 画面上の位置 {x, y}
     * @param {string} trackId - 設置された線路ID
     * @param {number} number - 連番
     */
    constructor(id, position, trackId, number = 1) {
        super('destButton', position.x, position.y);
        this.id = id;                  // ボタンID（親クラスのIDを上書き）
        this.trackId = trackId;        // 設置された線路ID
        this.state = BUTTON_STATES.NORMAL; // 初期状態は通常
        this.routes = [];              // 対応する進路リスト

        // 名前を設定
        this.name = `着点ボタン${number}`;
    }

    /**
     * 着点ボタンの描画処理
     * @param {CanvasRenderingContext2D} ctx - Canvas 2D コンテキスト
     * @param {number} scale - キャンバスの拡大縮小倍率
     */
    draw(ctx, scale = 1) {
        ctx.save();  // 現在の描画状態を保存
        // --- 線路指定待ち強調 ---
        if (this.isPendingTrackAssign) {
            const now = Date.now();
            const blink = Math.floor(now / 500) % 2 === 0;
            ctx.save();
            ctx.beginPath();
            ctx.arc(this.x ?? 0, this.y ?? 0, 16 / scale, 0, Math.PI * 2);
            ctx.lineWidth = 4 / scale;
            ctx.strokeStyle = blink ? 'rgba(255,128,0,0.9)' : 'rgba(255,200,0,0.7)';
            ctx.setLineDash([6, 6]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
        }
        // --- ここまで ---
        // 状態に応じた色
        ctx.fillStyle = BUTTON_COLORS[this.state];
        ctx.strokeStyle = '#999999';  // 境界線は暗めのグレー
        ctx.lineWidth = 1 / scale;
        // 円形ボタンの描画
        ctx.beginPath();
        ctx.arc(this.x, this.y, 10 / scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();  // 保存した描画状態に戻す
    }

    setState(state) {
        if (Object.values(BUTTON_STATES).includes(state)) {
            this.state = state;
        }
    }

    addRoute(route) {
        this.routes.push(route);
    }
}

/**
 * 発点てこクラス
 * 進路の始点となる制御レバーを表現する
 */
class StartLever extends InterlockingElement {
    /**
     * 発点てこのコンストラクタ
     * @param {string} id - てこの一意の識別子
     * @param {string} type - てこのタイプ (LEVER_TYPE_CODESのいずれか)
     * @param {number} x - X座標
     * @param {number} y - Y座標
     * @param {string} trackId - 設置された線路ID
     * @param {number} number - 連番
     */
    constructor(id, type, x, y, trackId, number = 1) {
        super(type, x, y);
        this.id = id;                  // てこID（親クラスのIDを上書き）
        this.trackId = trackId;        // 設置された線路ID
        this.state = LEVER_STATES.NEUTRAL; // 初期状態は中立
        this.selected = false;         // 選択状態
        this.routes = [];              // 対応する進路リスト
        this.animation = {             // アニメーション用のパラメータ
            blink: false,              // 点滅中か
            blinkCount: 0,             // 点滅カウンタ
            active: false              // 進路開通中か
        };

        // てこタイプに応じた名前を設定
        const typeNames = {
            'signal': '信号てこ',
            'shunting_signal': '入換てこ',
            'shunting_marker': '標識てこ',
            'through_lever': '開通てこ'
        };
        this.name = `${typeNames[type] || type}${number}`;
    }
    
    /**
     * 発点てこの描画処理
     * @param {CanvasRenderingContext2D} ctx - Canvas 2D コンテキスト
     * @param {number} scale - キャンバスの拡大縮小倍率
     * @param {number} [angle] - 進路方向＋45度（ラジアン）
     */
    draw(ctx, scale = 1, angle = 0) {
        console.log('draw angle', angle, this.id);
        ctx.save();
        // 位置へ移動
        ctx.translate(this.x, this.y);
        // 角度指定があれば回転（0でも必ず回転）
        if (typeof angle !== 'number' || isNaN(angle)) {
            console.warn('[LEVER-ANGLE-WARN] angle is NaN or not a number:', angle, this.id);
            angle = 0;
        }
        ctx.rotate(angle);
        // てこ本体
        ctx.beginPath();
        ctx.arc(0, 0, 16 / scale, 0, Math.PI * 2);
        ctx.fillStyle = this.animation.active ? '#ff9800' : '#fff';
        ctx.fill();
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2 / scale;
        ctx.stroke();
        // てこの棒
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -24 / scale);
        ctx.strokeStyle = this.animation.active ? '#ff9800' : '#333';
        ctx.lineWidth = 4 / scale;
        ctx.stroke();
        // ラベル
        ctx.font = `${12 / scale}px Arial`;
        ctx.fillStyle = '#333';
        ctx.textAlign = 'center';
        ctx.fillText(this.name || '', 0, 28 / scale);
        ctx.restore();
    }
    
    /**
     * クリック判定
     * @param {number} x - クリック位置のX座標
     * @param {number} y - クリック位置のY座標
     * @returns {boolean} クリックされたかどうか
     */
    isClicked(x, y) {
        // 簡易的なクリック判定 (円形の当たり判定)
        const dx = x - this.x;
        const dy = y - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        return distance < 15;  // 取っ手とベースを含む範囲
    }
    
    /**
     * クリック時の動作
     * @param {Object} interlockingSystem - 連動制御システム
     * @param {MouseEvent} event - マウスイベント
     * @returns {string} アクション結果
     */
    onClick(interlockingSystem, event) {
        // 操作モードの場合、左クリックと右クリックで動作を分ける
        if (window.app && window.app.appMode === 'operation') {
            // 中クリック（ホイールクリック）の場合
            if (event && event.button === 1) {
                // 中立位置に戻す
                this.selected = false;
                const prevState = this.state;
                this.state = LEVER_STATES.NEUTRAL;
                this.animation.active = false;
                
                return interlockingSystem.requestRouteRelease(this, prevState);
            }
            // 左クリックの場合（右向き）
            else if (event && event.button === 0) {
                // 中立から右向きに
                if (this.state !== LEVER_STATES.RIGHT) {
                    const prevState = this.state;
                    this.state = LEVER_STATES.RIGHT;
                    this.selected = true;
                    
                    if (prevState !== LEVER_STATES.NEUTRAL) {
                        // 元の状態が中立以外の場合は進路解除
                        return interlockingSystem.requestRouteRelease(this, prevState);
                    } else {
                        // 元の状態が中立の場合は進路選択開始
                        return interlockingSystem.onStartLeverSelected(this);
                    }
                } else {
                    // 既に右向きの場合は進路解除
                    this.selected = false;
                    const prevState = this.state;
                    this.state = LEVER_STATES.NEUTRAL;
                    this.animation.active = false;
                    
                    return interlockingSystem.requestRouteRelease(this, prevState);
                }
            } 
            // 右クリックの場合（左向き）
            else {
                // 中立から左向きに
                if (this.state !== LEVER_STATES.LEFT) {
                    const prevState = this.state;
                    this.state = LEVER_STATES.LEFT;
                    this.selected = true;
                    
                    if (prevState !== LEVER_STATES.NEUTRAL) {
                        // 元の状態が中立以外の場合は進路解除
                        return interlockingSystem.requestRouteRelease(this, prevState);
                    } else {
                        // 元の状態が中立の場合は進路選択開始
                        return interlockingSystem.onStartLeverSelected(this);
                    }
                } else {
                    // 既に左向きの場合は進路解除
                    this.selected = false;
                    const prevState = this.state;
                    this.state = LEVER_STATES.NEUTRAL;
                    this.animation.active = false;
                    
                    return interlockingSystem.requestRouteRelease(this, prevState);
                }
            }
        } else {
            // 編集モード - 元の動作を維持
            if (this.state === LEVER_STATES.NEUTRAL) {
                // 中立から操作開始
                // 方向選択ロジック (単純化のため右方向に固定)
                this.state = LEVER_STATES.RIGHT;
                this.selected = true;
                
                // 連動システムに発点てこが選択されたことを通知
                return interlockingSystem.onStartLeverSelected(this);
            } else {
                // 進路解除操作
                this.selected = false;
                const prevState = this.state;
                this.state = LEVER_STATES.NEUTRAL;
                this.animation.active = false;
                
                // 連動システムに進路解除リクエストを発行
                return interlockingSystem.requestRouteRelease(this, prevState);
            }
        }
    }
    
    /**
     * 進路開通状態の設定
     * @param {boolean} active - 進路開通中かどうか
     */
    setActive(active) {
        this.animation.active = active;
        if (active) {
            this.animation.blink = false;
            this.animation.blinkCount = 0;
        }
    }
    
    /**
     * 対応する進路の追加
     * @param {Object} route - 進路オブジェクト
     */
    addRoute(route) {
        this.routes.push(route);
    }
}

/**
 * 線路絶縁クラス
 * 線路の電気的区切りを表現する
 */
class TrackInsulation {
    /**
     * 線路絶縁のコンストラクタ
     * @param {string} id - 絶縁の一意の識別子
     * @param {Object} position - 画面上の位置 {x, y}
     * @param {string} type - 絶縁のタイプ (INSULATION_TYPESのいずれか)
     * @param {number} direction - 向き (度数: 0, 90, 180, 270)
     */
    constructor(id, position, type, direction) {
        this.id = id;                // 絶縁ID
        this.position = position;    // 画面上の位置
        this.type = type;            // タイプ
        this.direction = direction;  // 向き (度数)
        this.trackSegments = [];     // 隣接する線路セグメント情報
    }
    
    /**
     * 線路絶縁の描画処理
     * @param {CanvasRenderingContext2D} ctx - Canvas 2D コンテキスト
     * @param {number} scale - キャンバスの拡大縮小倍率
     */
    draw(ctx, scale = 1) {
        if (this.selected) {
            ctx.strokeStyle = '#FF0000';
        } else {
            ctx.strokeStyle = '#000000';
        }
        
        ctx.lineWidth = 1 / scale;
        
        // 絶縁のタイプに基づいて描画
        if (this.type === INSULATION_TYPES.STRAIGHT) {
            // 直線絶縁
            ctx.beginPath();
            ctx.moveTo(-15 / scale, 0);
            ctx.lineTo(-5 / scale, 0);
            ctx.stroke();
            
            ctx.beginPath();
            ctx.moveTo(5 / scale, 0);
            ctx.lineTo(15 / scale, 0);
            ctx.stroke();
            
            // 絶縁部分（空白）を白い短い線で表現
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 2 / scale;
            ctx.beginPath();
            ctx.moveTo(-5 / scale, 0);
            ctx.lineTo(5 / scale, 0);
            ctx.stroke();
            
            ctx.beginPath();
            ctx.moveTo(-5 / scale, -5 / scale);
            ctx.lineTo(5 / scale, -5 / scale);
            ctx.stroke();
            
            ctx.beginPath();
            ctx.moveTo(-5 / scale, 5 / scale);
            ctx.lineTo(5 / scale, 5 / scale);
            ctx.stroke();
        }
        
        // 選択された場合の表示を追加
        if (this.selected) {
            ctx.strokeStyle = '#FF0000';
            ctx.lineWidth = 1 / scale;
            ctx.beginPath();
            ctx.arc(0, 0, 20 / scale, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
    
    /**
     * 隣接する線路セグメントを追加
     * @param {string} trackId - 線路ID
     * @param {string} circuitId - 軌道回路ID
     */
    addTrackSegment(trackId, circuitId) {
        this.trackSegments.push({
            trackId: trackId,
            circuitId: circuitId
        });
    }
}

// グローバルスコープに公開
window.StartLever = StartLever;
window.DestinationButton = DestinationButton;
window.TrackInsulation = TrackInsulation;
window.LEVER_TYPE_CODES = LEVER_TYPE_CODES;
window.LEVER_COLORS = LEVER_COLORS;
window.LEVER_STATES = LEVER_STATES;
window.BUTTON_STATES = BUTTON_STATES;
window.BUTTON_COLORS = BUTTON_COLORS;
window.INSULATION_TYPES = INSULATION_TYPES;
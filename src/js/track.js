class Track {
    constructor(id, type, x, y) {
        this.id = id;                // 線路ID
        this.type = type;            // 線路タイプ
        this.name = `${this.getTrackTypeName(type)}${id}`; // 線路名称
        this.endpoints = [];         // 端点座標の配列 [{x, y}, ...]
        this.connections = new Map(); // Map<endpointIndex, { trackId, endpointIndex }>
        this.visible = true;         // 表示/非表示
        this.status = 'normal';      // 線路の状態
        this.statusMap = {};         // 端点ペアごとの状態（ダブルクロス用）
        this.rotation = 0;
        
        // ポイント関連のプロパティ
        this.isPoint = type.includes('point_') || type === 'double_cross' || type === 'double_slip_x';
        this.isInsulation = false; // 絶縁パーツかどうかのフラグ
        this.pointDirection = 'normal'; // 'normal' = 直進、'reverse' = 分岐
        this.dccAddress = 0; // ポイントのDCCアドレス
        this.invertDcc = false;  // DCC出力反転フラグ
        
        this.setPosition(x, y);
    }

    // 線路タイプから表示名を取得
    getTrackTypeName(type) {
        const typeNames = {
            'straight': '直線',
            'point_left': 'CL',
            'point_right': 'CR',
            'double_slip': 'DX',
            'double_slip_x': 'DS',
            'crossing': 'X',
            'end': 'END'
        };
        return typeNames[type] || type;
    }

    
    // 端点を追加
    addEndpoint(x, y) {
        this.endpoints.push({x, y});
    }

    // 端点を更新
    updateEndpoint(index, x, y) {
        if (index >= 0 && index < this.endpoints.length) {
            this.endpoints[index] = {x, y};
        }
    }

    // 端点の接続を設定
    connect(endpointIndex, otherTrack, otherEndpointIndex) {
        if (endpointIndex >= 0 && endpointIndex < this.endpoints.length) {
            this.connections.set(endpointIndex, {
                trackId: otherTrack.id,
                endpointIndex: otherEndpointIndex
            });
        }
    }

    // 端点の接続を解除
    disconnect(endpointIndex) {
        this.connections.delete(endpointIndex);
    }

    // 表示/非表示を切り替え
    toggleVisibility() {
        this.visible = !this.visible;
    }

    // 状態を設定
    setStatus(status) {
        this.status = status;
    }

    // プリセット線路を作成
    static createPreset(id, type, x, y) {
        const track = new Track(id, type);
        const gridSize = CONFIG.CANVAS.GRID_SIZE;
        
        const snapToGrid = (value) => Math.round(value / gridSize) * gridSize;

        switch (type) {
            case 'straight':
                track.endpoints = [
                    { x: snapToGrid(x - gridSize), y: snapToGrid(y) },
                    { x: snapToGrid(x + gridSize), y: snapToGrid(y) }
                ];
                break;
            case 'point_left':
                track.endpoints = [
                    { x: snapToGrid(x - 2 * gridSize), y: snapToGrid(y) }, // 共通始点
                    { x: snapToGrid(x + 2 * gridSize), y: snapToGrid(y) }, // 直進方向終点
                    { x: snapToGrid(x), y: snapToGrid(y - gridSize) } // 分岐方向終点
                ];
                break;
            case 'point_right':
                track.endpoints = [
                    { x: snapToGrid(x - 2 * gridSize), y: snapToGrid(y) }, // 共通始点
                    { x: snapToGrid(x + 2 * gridSize), y: snapToGrid(y) }, // 直進方向終点
                    { x: snapToGrid(x), y: snapToGrid(y + gridSize) } // 分岐方向終点
                ];
                break;
            case 'double_cross':
                track.endpoints = [
                    { x: snapToGrid(x - 2 * gridSize), y: snapToGrid(y - gridSize) }, // 左上
                    { x: snapToGrid(x + 2 * gridSize), y: snapToGrid(y - gridSize) }, // 右上
                    { x: snapToGrid(x - 2 * gridSize), y: snapToGrid(y + gridSize) }, // 左下
                    { x: snapToGrid(x + 2 * gridSize), y: snapToGrid(y + gridSize) }  // 右下
                ];
                track.pointDirection = 'straight';
                break;
            case 'double_slip_x':
                track.endpoints = [
                    { x: snapToGrid(x - 2 * gridSize), y: snapToGrid(y -  gridSize) }, // 左上
                    { x: snapToGrid(x + 2 * gridSize), y: snapToGrid(y +  gridSize) }, // 右下
                    { x: snapToGrid(x - 2 * gridSize), y: snapToGrid(y +  gridSize) }, // 左下
                    { x: snapToGrid(x + 2 * gridSize), y: snapToGrid(y -  gridSize) }  // 右上
                ];
                if (!track.pointDirection) track.pointDirection = 'normal';
                break;
            case 'crossing':
                track.endpoints = [
                    { x: snapToGrid(x - gridSize), y: snapToGrid(y) }, // 左
                    { x: snapToGrid(x + gridSize), y: snapToGrid(y) }, // 右
                    { x: snapToGrid(x), y: snapToGrid(y - gridSize) }, // 上
                    { x: snapToGrid(x), y: snapToGrid(y + gridSize) }  // 下
                ];
                break;
            case 'end':
                track.endpoints = [
                    { x: snapToGrid(x), y: snapToGrid(y) } // 単一端点
                ];
                break;
            case 'curve':
                track.endpoints = [
                    { x: snapToGrid(x - gridSize), y: snapToGrid(y) },
                    { x: snapToGrid(x), y: snapToGrid(y - gridSize) }
                ];
                break;
            case 'straightInsulation':
                track.endpoints = [
                    { x: snapToGrid(x - gridSize), y: snapToGrid(y) }, // 左側端点
                    { x: snapToGrid(x + gridSize), y: snapToGrid(y) }  // 右側端点
                ];
                track.isInsulation = true;
                break;
        }
        return track;
    }

    setPosition(x, y) {
        if (this.endpoints.length === 0) return;
        
        const offsetX = x - this.endpoints[0].x;
        const offsetY = y - this.endpoints[0].y;
        
        this.endpoints.forEach(point => {
            point.x += offsetX;
            point.y += offsetY;
        });
    }

    // 指定した端点の接続情報を取得
    getConnection(endpointIndex) {
        // endpointIndexを数値に変換して比較
        if (this.connections instanceof Map) {
            return this.connections.get(Number(endpointIndex)) || null;
        } else if (Array.isArray(this.connections)) {
            const found = this.connections.find(([idx, _]) => Number(idx) === Number(endpointIndex));
            return found ? found[1] : null;
        }
        return null;
    }

    // 線路を回転させる
    rotate(angle) {
        if (this.endpoints.length === 0) return;
        
        // 回転の中心点を計算（全ての端点の平均位置）
        let centerX = 0;
        let centerY = 0;
        
        this.endpoints.forEach(point => {
            centerX += point.x;
            centerY += point.y;
        });
        
        centerX /= this.endpoints.length;
        centerY /= this.endpoints.length;
        
        // 各端点を中心点を基準に回転
        this.endpoints.forEach(point => {
            // 中心点からの相対座標
            const dx = point.x - centerX;
            const dy = point.y - centerY;
            
            // 回転行列を適用
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const newX = centerX + dx * cos - dy * sin;
            const newY = centerY + dx * sin + dy * cos;
            
            // 回転後の座標をグリッドにスナップ
            const gridSize = CONFIG.CANVAS.GRID_SIZE;
            point.x = Math.round(newX / gridSize) * gridSize;
            point.y = Math.round(newY / gridSize) * gridSize;
        });
    }

    // 時計回りに90度回転
    rotateClockwise() {
        this.rotate(Math.PI / 2);
    }
    
    // 反時計回りに90度回転
    rotateCounterClockwise() {
        this.rotate(-Math.PI / 2);
    }

    /**
     * ポイントのDCCアドレスを設定
     * @param {number} address - DCCアドレス 
     */
    setDccAddress(address) {
        this.dccAddress = address;
    }

    /**
     * ポイントの方向を設定
     * @param {string} direction - 'normal'または'reverse'
     * @returns {Promise<boolean>} 成功したかどうか
     */
    async setPointDirection(direction) {
        if (!this.isPoint) return false;
        // 方向の検証
        if (direction !== 'normal' && direction !== 'reverse') {
            console.error('無効なポイント方向:', direction);
            return false;
        }
        console.log(`[DEBUG:setPointDirection] called: trackId=${this.id}, type=${this.type}, direction=${direction}, before=${this.pointDirection}`);
        // デバッグ: DSAir送信条件の値を出力
        console.log('[DEBUG] dccAddress:', this.dccAddress, 'dsair.isConnected:', window.dsair && window.dsair.isConnected);
        // DCCアドレスがある場合は制御コマンドを送信
        if (this.dccAddress && window.dsair && window.dsair.isConnected) {
            try {
                // invertDcc フラグがtrueの場合、DCC出力を反転
                const dccDirection = this.invertDcc ? 
                    (direction === 'normal' ? 'reverse' : 'normal') : 
                    direction;
                // DSAirにポイント切替コマンドを送信
                const result = await DSAir.switchPoint(this.dccAddress, dccDirection);
                if (!result.success) {
                    console.error('ポイント制御コマンドの送信に失敗しました:', result.error);
                    // DSAir送信に失敗しても仮想的に切り替えるため、エラーリターンは行わない
                }
            } catch (error) {
                console.error('ポイント制御中にエラーが発生しました:', error);
                // DSAir送信に失敗しても仮想的に切り替えるため、エラーリターンは行わない
            }
        }
        // ポイント方向を更新（DSAirの成功/失敗に関わらず常に更新）
        this.pointDirection = direction;
        console.log(`[DEBUG:setPointDirection] after: trackId=${this.id}, type=${this.type}, pointDirection=${this.pointDirection}`);
        return true;
    }

    /**
     * ポイントの方向を切り替える
     * @returns {Promise<boolean>} 成功したかどうか
     */
    async togglePointDirection() {
        const newDirection = this.pointDirection === 'normal' ? 'reverse' : 'normal';
        return await this.setPointDirection(newDirection);
    }

    /**
     * ダブルクロスの方向を設定
     * @param {string} direction - 'straight'または'cross'
     * @returns {Promise<boolean>} 成功したかどうか
     */
    async setCrossDirection(direction) {
        if (this.type !== 'double_cross') return false;
        if (direction !== 'straight' && direction !== 'cross') {
            console.error('無効なダブルクロス方向:', direction);
            return false;
        }
        console.log(`[DEBUG:setCrossDirection] called: trackId=${this.id}, type=${this.type}, direction=${direction}, before=${this.pointDirection}`);
        this.pointDirection = direction;
        console.log(`[DEBUG:setCrossDirection] after: trackId=${this.id}, pointDirection=${this.pointDirection}`);
        return true;
    }

    // JSONに変換
    toJSON() {
        // endpointsが空や不正な場合はデフォルト値
        let endpoints = Array.isArray(this.endpoints) && this.endpoints.length > 0 ? this.endpoints : [{x:0, y:0}, {x:20, y:0}];
        // x/yもendpoints[0]から取得
        let x = (endpoints[0] && typeof endpoints[0].x === 'number') ? endpoints[0].x : 0;
        let y = (endpoints[0] && typeof endpoints[0].y === 'number') ? endpoints[0].y : 0;
        return {
            id: this.id,
            type: this.type,
            name: this.name,
            endpoints: endpoints,
            x: x,
            y: y,
            connections: Array.from(this.connections.entries()),
            status: this.status,
            isPoint: this.isPoint,
            pointDirection: this.pointDirection,
            dccAddress: this.dccAddress,
            invertDcc: this.invertDcc,
            visible: this.visible
        };
    }
    
    // JSONから復元
    static fromJSON(data) {
        const track = new Track(data.id, data.type);
        track.name = data.name || track.name;
        // endpointsが配列で2点以上なければデフォルト値
        if (Array.isArray(data.endpoints) && data.endpoints.length > 0) {
            track.endpoints = data.endpoints;
        } else {
            // 最低限2点の直線をデフォルト
            track.endpoints = [{x:0, y:0}, {x:20, y:0}];
        }
        // x/yが必要な場合はendpoints[0]から取得
        if (track.endpoints[0]) {
            track.x = track.endpoints[0].x;
            track.y = track.endpoints[0].y;
        }
        track.connections = new Map(data.connections || []);
        track.status = data.status || 'normal';
        track.isPoint = data.isPoint || false;
        if (data.type === 'double_cross') {
            track.pointDirection = data.pointDirection || 'straight';
        } else {
            track.pointDirection = data.pointDirection || 'normal';
        }
        track.dccAddress = data.dccAddress || null;
        track.invertDcc = data.invertDcc || false;
        track.visible = data.visible !== undefined ? data.visible : true;
        return track;
    }

    // 任意の2点を指定して直線パーツを生成
    static createCustomStraight(id, x1, y1, x2, y2) {
        const track = new Track(id, 'straight');
        track.endpoints = [
            { x: x1, y: y1 },
            { x: x2, y: y2 }
        ];
        return track;
    }

    // 端点ペアごとの状態を設定
    setPairStatus(fromIdx, toIdx, status) {
        if (this.type === 'double_cross') {
            this.statusMap[`${fromIdx}-${toIdx}`] = status;
        }
    }

    // 端点ペアごとの状態を取得
    getPairStatus(fromIdx, toIdx) {
        if (this.type === 'double_cross') {
            return this.statusMap[`${fromIdx}-${toIdx}`] || 'normal';
        }
        return this.status;
    }

    // すべての端点ペア状態をクリア
    clearAllPairStatus() {
        if (this.type === 'double_cross') {
            this.statusMap = {};
        }
    }
}

// 線路データ管理クラス
class TrackManager {
    constructor() {
        this.tracks = new Map();         // 線路データの格納用Map
        this.selectedTrack = null;       // 選択中の線路
        this.nextTrackId = 1;           // 次の線路ID
        this.listeners = [];             // イベントリスナーを保持する配列
    }

    // イベントリスナーを追加
    addListener(listener) {
        this.listeners.push(listener);
    }
    
    // イベントリスナーを削除
    removeListener(listener) {
        const index = this.listeners.indexOf(listener);
        if (index !== -1) {
            this.listeners.splice(index, 1);
        }
    }
    
    // トラック追加イベントを通知
    notifyTrackAdded(track) {
        this.listeners.forEach(listener => {
            if (typeof listener.trackAdded === 'function') {
                listener.trackAdded(track);
            }
        });
    }
    
    // トラック削除イベントを通知
    notifyTrackRemoved(trackId) {
        this.listeners.forEach(listener => {
            if (typeof listener.trackRemoved === 'function') {
                listener.trackRemoved(trackId);
            }
        });
    }

    // 線路を追加
    addTrack(track) {
        // まず全端点で3つ以上になるかチェック
        for (let i = 0; i < track.endpoints.length; i++) {
            const endpoint = track.endpoints[i];
            const overlapping = this.findAllEndpointsAtPosition(endpoint.x, endpoint.y, track.id);
            if (overlapping.length >= 2) {
                if (typeof window.app?.setStatusInfo === 'function') {
                    window.app.setStatusInfo('同じ座標上に3つ以上の端点は配置できません', true);
                }
                return false;
            }
        }
        // 先にtrackを追加
        this.tracks.set(track.id, track);

        // 端点ごとに自動接続
        for (let i = 0; i < track.endpoints.length; i++) {
            const endpoint = track.endpoints[i];
            const overlapping = this.findAllEndpointsAtPosition(endpoint.x, endpoint.y, track.id);
            if (overlapping.length === 1) {
                const { track: otherTrack, endpointIndex: otherEndpointIndex } = overlapping[0];
                this.connectTracks(track.id, i, otherTrack.id, otherEndpointIndex);
            }
        }
        this.notifyTrackAdded(track);
        return true;
    }

    /**
     * 指定座標にある全ての端点を返す（自身のtrackIdは除外）
     * @param {number} x
     * @param {number} y
     * @param {string|number} [excludeTrackId]
     * @returns {Array<{track: Track, endpointIndex: number}>}
     */
    findAllEndpointsAtPosition(x, y, excludeTrackId = null) {
        const radius = (typeof CONFIG !== 'undefined' && CONFIG.CANVAS && CONFIG.CANVAS.CONNECTION_RADIUS) ? CONFIG.CANVAS.CONNECTION_RADIUS : 10;
        const endpoints = [];
        for (const track of this.tracks.values()) {
            if (!track.visible) continue;
            if (excludeTrackId && track.id === excludeTrackId) continue;
            track.endpoints.forEach((endpoint, index) => {
                const dx = endpoint.x - x;
                const dy = endpoint.y - y;
                if (dx * dx + dy * dy <= radius * radius) {
                    endpoints.push({ track, endpointIndex: index });
                }
            });
        }
        return endpoints;
    }

    // 線路を削除
    removeTrack(trackId) {
        const track = this.tracks.get(trackId);
        if (track) {
            // この線路から全ての接続を切断
            track.connections.forEach((connection, endpointIndex) => {
                const connectedTrack = this.tracks.get(connection.trackId);
                if (connectedTrack) {
                    // 接続先の線路から、この線路への接続を切断
                    connectedTrack.disconnect(connection.endpointIndex);
                }
            });
            
            this.tracks.delete(trackId);
            this.notifyTrackRemoved(trackId);
        }
    }

    // 線路を取得
    getTrack(trackId) {
        return this.tracks.get(trackId);
    }

    // ポイントタイプの線路をすべて取得
    getPoints() {
        const points = [];
        for (const track of this.tracks.values()) {
            if (track.isPoint) {
                points.push({
                    id: track.id,
                    address: track.dccAddress,
                    direction: track.pointDirection,
                    type: track.type
                });
            }
        }
        return points;
    }

    // ポイントのアドレスを更新
    updatePointAddress(trackId, address) {
        const track = this.tracks.get(trackId);
        if (track && track.isPoint) {
            track.setDccAddress(address);
            return true;
        }
        return false;
    }

    // ポイントの方向を切り替え
    async switchPoint(trackId, direction) {
        const track = this.tracks.get(trackId);
        if (track && track.isPoint) {
            return await track.setPointDirection(direction);
        }
        return false;
    }

    // 新しい線路IDを生成
    generateTrackId() {
        // 既存IDの最大値+1
        let maxId = 0;
        for (const id of this.tracks.keys()) {
            const num = Number(id);
            if (!isNaN(num) && num > maxId) maxId = num;
        }
        this.nextTrackId = Math.max(this.nextTrackId, maxId + 1);
        return this.nextTrackId++;
    }

    // 指定座標に最も近い端点を探す
    findNearestEndpoint(x, y) {
        let nearest = null;
        let minDistance = CONFIG.CANVAS.CONNECTION_RADIUS;

        for (const track of this.tracks.values()) {
            if (!track.visible) continue;

            track.endpoints.forEach((point, index) => {
                const dx = point.x - x;
                const dy = point.y - y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < minDistance) {
                    minDistance = distance;
                    nearest = { track, endpointIndex: index };
                }
            });
        }

        return nearest;
    }

    // 線路を接続
    connectTracks(trackId1, endpointIndex1, trackId2, endpointIndex2) {
        const track1 = this.tracks.get(trackId1);
        const track2 = this.tracks.get(trackId2);

        if (track1 && track2) {
            // 既存の接続を解除
            this.disconnectTrack(trackId1, endpointIndex1);
            this.disconnectTrack(trackId2, endpointIndex2);

            // 新しい接続を設定
            track1.connect(endpointIndex1, track2, endpointIndex2);
            track2.connect(endpointIndex2, track1, endpointIndex1);
        }
    }

    disconnectTrack(trackId, endpointIndex) {
        const track = this.tracks.get(trackId);
        if (track) {
            const connection = track.getConnection(endpointIndex);
            if (connection) {
                const otherTrack = this.tracks.get(connection.trackId);
                if (otherTrack) {
                    otherTrack.disconnect(connection.endpointIndex);
                }
                track.disconnect(endpointIndex);
            }
        }
    }

    // 配線略図データをJSON形式で出力
    exportData() {
        const data = {
            tracks: [],
            nextTrackId: this.nextTrackId
        };

        for (const track of this.tracks.values()) {
            data.tracks.push(track.toJSON());
        }

        return JSON.stringify(data);
    }

    // JSON形式の配線略図データを読み込み
    importData(jsonData) {
        const result = origImportData.call(this, jsonData);
        // 既存IDの最大値+1にnextTrackIdをセット
        let maxId = 0;
        for (const id of this.tracks.keys()) {
            const num = Number(id);
            if (!isNaN(num) && num > maxId) maxId = num;
        }
        this.nextTrackId = maxId + 1;
        return result;
    }

    /**
     * トラックの更新
     * @param {Track} track - 更新するトラック
     * @returns {boolean} 更新が成功したかどうか
     */
    updateTrack(track) {
        if (!track || !track.id || !this.tracks.has(track.id)) {
            return false;
        }
        
        // トラックを更新
        this.tracks.set(track.id, track);
        
        return true;
    }
    
    /**
     * ポイントのDCCアドレスを更新
     * @param {string} trackId - ポイントのID
     * @param {number} address - 設定するDCCアドレス
     * @returns {boolean} 更新が成功したかどうか
     */
    updatePointAddress(trackId, address) {
        const track = this.getTrack(trackId);
        if (!track || !track.isPoint) {
            return false;
        }
        
        // DCCアドレスを更新
        track.setDccAddress(address);
        
        return true;
    }
    
    /**
     * ポイントの方向を切り替え
     * @param {string} trackId - ポイントのID
     * @param {string} direction - 設定する方向 ('normal'または'reverse')
     * @returns {Promise<boolean>} 切り替えが成功したかどうか
     */
    async switchPoint(trackId, direction) {
        const track = this.getTrack(trackId);
        if (!track || !track.isPoint) {
            return false;
        }
        
        // ポイントの方向を設定
        const result = await track.setPointDirection(direction);
        return result;
    }
}

// グローバルスコープでエクスポート
window.Track = Track;
window.TrackManager = TrackManager;

class TrackElement {
    constructor(type, x, y) {
        this.id = crypto.randomUUID();
        this.type = type;
        this.x = x;
        this.y = y;
        this.rotation = 0;
        this.connections = {
            normal: null,
            reverse: null
        };
    }

    createElement() {
        const element = document.createElement('div');
        element.className = 'track-element';
        element.dataset.trackElement = 'true';
        element.dataset.trackId = this.id;
        element.dataset.trackType = this.type;
        
        // ポイントの場合、追加のデータ属性を設定
        if (this.type === 'point-left' || this.type === 'point-right') {
            element.dataset.normalConnection = this.connections.normal?.id || '';
            element.dataset.reverseConnection = this.connections.reverse?.id || '';
            element.dataset.position = 'normal'; // 初期位置は直進
        }

        // クリックイベントの追加
        element.addEventListener('click', (e) => {
            if (routeManager.currentMode === 'auto' || routeManager.currentMode === 'manual') {
                const position = element.dataset.position || 'normal';
                routeManager.handlePointClick(this.id, position);
                e.stopPropagation(); // イベントの伝播を停止
            }
        });

        // 右クリックでポイント位置切り替え
        element.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (this.type === 'point-left' || this.type === 'point-right') {
                const currentPosition = element.dataset.position || 'normal';
                const newPosition = currentPosition === 'normal' ? 'reverse' : 'normal';
                element.dataset.position = newPosition;
                
                // 視覚的なフィードバック
                element.classList.remove(`position-${currentPosition}`);
                element.classList.add(`position-${newPosition}`);
                
                // 手動モードの場合、位置情報を更新
                if (routeManager.currentMode === 'manual' && routeManager.tempRoute) {
                    const pointIndex = routeManager.tempRoute.points.findIndex(p => p.id === this.id);
                    if (pointIndex !== -1) {
                        routeManager.tempRoute.points[pointIndex].position = newPosition;
                    }
                }
            }
        });

        return element;
    }
} 
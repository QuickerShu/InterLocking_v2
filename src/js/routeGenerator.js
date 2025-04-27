/**
 * 進路自動生成機能
 * 作成した配線略図と発点てこ・着点ボタンの配置情報から進路データを自動生成する
 */

class RouteGenerator {
    constructor(trackManager, interlockingManager, interlockingSystem) {
        this.trackManager = trackManager;
        this.interlockingManager = interlockingManager;
        this.interlockingSystem = interlockingSystem;
        
        // 進路一覧
        this.routes = [];
        
        // 経路探索の最大深度
        this.maxSearchDepth = 50;
    }
    
    /**
     * 進路を自動生成する
     * @returns {Array} 生成された進路の配列
     */
    generateRoutes() {
        // 既存の進路をクリア
        this.routes = [];
        
        // 発点てこの取得
        const startLevers = this.interlockingManager.startLevers;
        
        // 着点ボタンの取得
        const destButtons = this.interlockingManager.destinationButtons;
        
        // 進路の探索と生成
        for (const lever of startLevers) {
            // 左向き・右向きの発点てこ別に進路を探索
            if (lever.type === 'signal') {
                // 信号てこは左右に倒れるので両方向探索
                this._exploreRoutesForLever(lever, 'left', destButtons);
                this._exploreRoutesForLever(lever, 'right', destButtons);
            } else {
                // その他のてこはてこタイプに応じた方向で探索
                this._exploreRoutesForLever(lever, lever.type, destButtons);
            }
        }
        
        return this.routes;
    }
    
    /**
     * 特定の発点てこと方向に対する進路を探索する
     * @private
     * @param {Object} lever 発点てこ
     * @param {string} direction 方向 ('left'または'right')
     * @param {Array} destButtons 着点ボタンの配列
     */
    _exploreRoutesForLever(lever, direction, destButtons) {
        // てこが配置されている線路を取得
        const leverTrack = this.trackManager.getTrack(lever.trackId);
        if (!leverTrack) return;
        
        // 探索開始点：線路と端点
        const visited = new Set(); // 訪問済み線路のID
        const path = []; // 経路
        const points = []; // 進路内のポイント
        
        // 探索開始
        this._searchPath(
            leverTrack, 
            direction, 
            destButtons, 
            visited, 
            path, 
            points, 
            lever, 
            0 // 現在の探索深度
        );
    }
    
    /**
     * 経路探索を行う（再帰関数）
     * @private
     * @param {Object} currentTrack 現在の線路
     * @param {string} direction 方向
     * @param {Array} destButtons 着点ボタンの配列
     * @param {Set} visited 訪問済み線路のIDセット
     * @param {Array} path 現在までの経路
     * @param {Array} points 経路上のポイント情報
     * @param {Object} lever 発点てこ
     * @param {number} depth 現在の探索深度
     */
    _searchPath(currentTrack, direction, destButtons, visited, path, points, lever, depth) {
        // 最大深度を超えたら探索を中止
        if (depth > this.maxSearchDepth) return;
        
        // 現在の線路を訪問済みに追加
        visited.add(currentTrack.id);
        
        // 現在の線路を経路に追加
        path.push({
            trackId: currentTrack.id,
            x: currentTrack.endpoints[0].x,
            y: currentTrack.endpoints[0].y
        });
        
        // 着点ボタンをチェック - この線路に着点ボタンがあるか確認
        for (const button of destButtons) {
            if (button.trackId === currentTrack.id) {
                // 着点ボタンが見つかった - 進路を作成
                this._createRoute(lever, button, path, points);
                break;
            }
        }
        
        // ポイントレールの場合はポイント情報を追加
        if (currentTrack.isPoint) {
            points.push({
                trackId: currentTrack.id,
                address: currentTrack.dccAddress || 0,
                direction: this._getPointDirectionForPath(currentTrack, direction),
                type: currentTrack.type
            });
        }
        
        // 次に進む線路を探索
        const nextTrackInfo = this._findNextTrack(currentTrack, direction, visited);
        
        // 次の線路がある場合は探索を続行
        if (nextTrackInfo) {
            this._searchPath(
                nextTrackInfo.track,
                nextTrackInfo.direction,
                destButtons,
                new Set(visited), // 新しいセットを作成（分岐探索のため）
                [...path], // 新しい配列を作成（分岐探索のため）
                [...points], // 新しい配列を作成（分岐探索のため）
                lever,
                depth + 1
            );
            
            // ポイントレールの場合は分岐方向も探索
            if (currentTrack.isPoint && currentTrack.type !== 'crossing') {
                const branchDirectionInfo = this._findBranchDirection(currentTrack, direction, visited);
                
                if (branchDirectionInfo) {
                    // ポイントの方向を分岐用に更新
                    const branchPoints = [...points];
                    const lastPointIndex = branchPoints.findIndex(p => p.trackId === currentTrack.id);
                    
                    if (lastPointIndex !== -1) {
                        branchPoints[lastPointIndex] = {
                            ...branchPoints[lastPointIndex],
                            direction: branchDirectionInfo.pointDirection
                        };
                    }
                    
                    this._searchPath(
                        branchDirectionInfo.track,
                        branchDirectionInfo.direction,
                        destButtons,
                        new Set(visited), // 新しいセットを作成
                        [...path], // 新しい配列を作成
                        branchPoints, // 分岐用に更新したポイント配列
                        lever,
                        depth + 1
                    );
                }
            }
        }
    }
    
    /**
     * 次に進む線路を探す
     * @private
     * @param {Object} currentTrack 現在の線路
     * @param {string} direction 方向
     * @param {Set} visited 訪問済み線路のIDセット
     * @returns {Object|null} 次の線路情報またはnull
     */
    _findNextTrack(currentTrack, direction, visited) {
        // 線路の種類に応じて次に進む端点を決定
        let nextEndpointIndex;
        
        if (currentTrack.type === 'straight' || currentTrack.type === 'straightInsulation') {
            // 直線の場合は方向に応じて端点を選択
            nextEndpointIndex = direction === 'left' ? 0 : 1;
        } else if (currentTrack.type === 'point_left' || currentTrack.type === 'point_right') {
            // ポイントの場合は直進方向の端点を選択
            nextEndpointIndex = direction === 'left' ? 0 : 1;
        } else if (currentTrack.type === 'crossing') {
            // 交差の場合は方向に応じて端点を選択
            if (direction === 'left') nextEndpointIndex = 0;
            else if (direction === 'right') nextEndpointIndex = 1;
            else if (direction === 'up') nextEndpointIndex = 2;
            else if (direction === 'down') nextEndpointIndex = 3;
        } else if (currentTrack.type === 'double_slip_x' || currentTrack.type === 'double_cross') {
            // ダブルスリップ/ダブルクロスの場合
            if (direction === 'left-up') nextEndpointIndex = 0;
            else if (direction === 'right-down') nextEndpointIndex = 1;
            else if (direction === 'left-down') nextEndpointIndex = 2;
            else if (direction === 'right-up') nextEndpointIndex = 3;
        } else if (currentTrack.type === 'end') {
            // 終端の場合は次の線路なし
            return null;
        } else {
            // その他の未知の線路タイプの場合
            return null;
        }
        
        // 選択した端点の接続情報を取得
        const connection = currentTrack.getConnection(nextEndpointIndex);
        if (!connection) return null;
        
        // 接続先の線路を取得
        const nextTrack = this.trackManager.getTrack(connection.trackId);
        if (!nextTrack || visited.has(nextTrack.id)) return null;
        
        // 次の方向を決定
        const nextDirection = this._determineNextDirection(nextTrack, connection.endpointIndex);
        
        return {
            track: nextTrack,
            direction: nextDirection
        };
    }
    
    /**
     * 分岐方向を探す（ポイントレール用）
     * @private
     * @param {Object} pointTrack ポイントレール
     * @param {string} direction 現在の方向
     * @param {Set} visited 訪問済み線路のIDセット
     * @returns {Object|null} 分岐方向の線路情報またはnull
     */
    _findBranchDirection(pointTrack, direction, visited) {
        // ポイントでない場合はnullを返す
        if (!pointTrack.isPoint) return null;
        
        let branchEndpointIndex;
        let pointDirection;
        
        if (pointTrack.type === 'point_left' || pointTrack.type === 'point_right') {
            // 左分岐または右分岐の場合
            branchEndpointIndex = 2; // 分岐方向は通常エンドポイント2
            pointDirection = 'reverse'; // 分岐方向のポイント設定
        } else if (pointTrack.type === 'double_slip_x' || pointTrack.type === 'double_cross') {
            // ダブルスリップまたはダブルクロスの場合
            // 現在の方向に応じて分岐方向を設定
            if (direction === 'left-up') {
                branchEndpointIndex = 3; // 右上
                pointDirection = 'reverse';
            } else if (direction === 'right-down') {
                branchEndpointIndex = 0; // 左上
                pointDirection = 'reverse';
            } else if (direction === 'left-down') {
                branchEndpointIndex = 1; // 右下
                pointDirection = 'reverse';
            } else if (direction === 'right-up') {
                branchEndpointIndex = 2; // 左下
                pointDirection = 'reverse';
            } else {
                return null;
            }
        } else {
            return null;
        }
        
        // 分岐方向の接続情報を取得
        const connection = pointTrack.getConnection(branchEndpointIndex);
        if (!connection) return null;
        
        // 接続先の線路を取得
        const branchTrack = this.trackManager.getTrack(connection.trackId);
        if (!branchTrack || visited.has(branchTrack.id)) return null;
        
        // 分岐方向の次の方向を決定
        const branchDirection = this._determineNextDirection(branchTrack, connection.endpointIndex);
        
        return {
            track: branchTrack,
            direction: branchDirection,
            pointDirection: pointDirection
        };
    }
    
    /**
     * 次の線路での進行方向を決定する
     * @private
     * @param {Object} track 線路
     * @param {number} entryEndpointIndex 進入する端点のインデックス
     * @returns {string} 方向
     */
    _determineNextDirection(track, entryEndpointIndex) {
        // 線路の種類と進入端点に基づいて次の方向を決定
        if (track.type === 'straight' || track.type === 'straightInsulation') {
            return entryEndpointIndex === 0 ? 'right' : 'left';
        } else if (track.type === 'point_left' || track.type === 'point_right') {
            if (entryEndpointIndex === 0) return 'right';
            else if (entryEndpointIndex === 1) return 'left';
            else return 'left'; // 分岐側から入る場合
        } else if (track.type === 'crossing') {
            if (entryEndpointIndex === 0) return 'right';
            else if (entryEndpointIndex === 1) return 'left';
            else if (entryEndpointIndex === 2) return 'down';
            else return 'up';
        } else if (track.type === 'double_slip_x' || track.type === 'double_cross') {
            if (entryEndpointIndex === 0) return 'right-down';
            else if (entryEndpointIndex === 1) return 'left-up';
            else if (entryEndpointIndex === 2) return 'right-up';
            else return 'left-down';
        } else if (track.type === 'end') {
            return 'end';
        }
        
        // デフォルトの方向
        return 'right';
    }
    
    /**
     * 進路方向に応じたポイントの向きを取得
     * @private
     * @param {Object} pointTrack ポイントレール
     * @param {string} direction 方向
     * @returns {string} ポイントの向き ('normal'または'reverse')
     */
    _getPointDirectionForPath(pointTrack, direction) {
        // デフォルトは直進
        if (pointTrack.type === 'point_left' || pointTrack.type === 'point_right') {
            return 'normal'; // 直進
        } else if (pointTrack.type === 'double_slip_x' || pointTrack.type === 'double_cross') {
            // ダブルスリップやダブルクロスの場合、方向に応じてポイント向きを決定
            return 'normal'; // デフォルトは直進
        }
        
        return 'normal';
    }
    
    /**
     * 進路データを作成する
     * @private
     * @param {Object} lever 発点てこ
     * @param {Object} button 着点ボタン
     * @param {Array} path 経路
     * @param {Array} points ポイント情報
     */
    _createRoute(lever, button, path, points) {
        // 進路名を生成
        const routeName = `${lever.id}->${button.id}`;
        
        // 進路データを作成
        const route = {
            name: routeName,
            path: path,
            points: points,
            sensors: [], // センサー情報（必要に応じて実装）
            approachLockTime: 10, // デフォルトの接近鎖錠時間（秒）
            holdLockTime: 5 // デフォルトの保留鎖錠時間（秒）
        };
        
        // 進路を一覧に追加
        this.routes.push(route);
        
        return route;
    }
    
    /**
     * 生成した進路を連動装置に登録する
     * @returns {boolean} 登録が成功したかどうか
     */
    registerRoutesToSystem() {
        try {
            // 生成した進路をシステムに登録
            for (const route of this.routes) {
                // 進路を連動装置に追加
                const routeId = this.interlockingSystem.addRoute(route);
                
                if (routeId) {
                    // 進路と発点てこを関連付け
                    this._associateRouteWithLeverAndButton(routeId, route);
                }
            }
            
            return true;
        } catch (error) {
            console.error('進路の登録に失敗しました:', error);
            return false;
        }
    }
    
    /**
     * 進路と発点てこ・着点ボタンを関連付ける
     * @private
     * @param {string} routeId 進路ID
     * @param {Object} route 進路データ
     */
    _associateRouteWithLeverAndButton(routeId, route) {
        // 進路名から発点てこIDと着点ボタンIDを抽出
        const [leverId, buttonId] = route.name.split('->');
        
        // 発点てこを取得
        const lever = this.interlockingManager.startLevers.find(l => l.id === leverId);
        if (lever) {
            // 進路を発点てこに関連付け
            const routeObj = this.interlockingSystem.getRoute(routeId);
            if (routeObj) {
                lever.addRoute(routeObj);
            }
        }
        
        // 着点ボタンを取得
        const button = this.interlockingManager.destinationButtons.find(b => b.id === buttonId);
        if (button) {
            // 進路を着点ボタンに関連付け
            const routeObj = this.interlockingSystem.getRoute(routeId);
            if (routeObj) {
                button.addRoute(routeObj);
            }
        }
    }
    
    /**
     * 手動で進路を作成する
     * @param {string} routeName 進路名
     * @param {Array} selectedTracks 選択された線路の配列
     * @param {Object} leverInfo 発点てこ情報
     * @param {Object} buttonInfo 着点ボタン情報
     * @returns {Object} 作成された進路
     */
    createManualRoute(routeName, selectedTracks, leverInfo, buttonInfo) {
        // 経路とポイント情報を抽出
        const path = [];
        const points = [];
        
        // 選択された線路から経路を作成
        for (const trackId of selectedTracks) {
            const track = this.trackManager.getTrack(trackId);
            if (track) {
                // 経路に追加
                path.push({
                    trackId: track.id,
                    x: track.endpoints[0].x,
                    y: track.endpoints[0].y
                });
                
                // ポイントの場合はポイント情報を追加
                if (track.isPoint) {
                    points.push({
                        trackId: track.id,
                        address: track.dccAddress || 0,
                        direction: 'normal', // デフォルトは直進
                        type: track.type
                    });
                }
            }
        }
        
        // 進路データを作成
        const route = {
            name: routeName || `手動進路-${Date.now()}`,
            path: path,
            points: points,
            sensors: [], // センサー情報（必要に応じて実装）
            approachLockTime: 10, // デフォルトの接近鎖錠時間（秒）
            holdLockTime: 5 // デフォルトの保留鎖錠時間（秒）
        };
        
        // 進路を一覧に追加
        this.routes.push(route);
        
        return route;
    }
    
    /**
     * 進路一覧をクリアする
     */
    clearRoutes() {
        this.routes = [];
    }
    
    /**
     * 進路一覧を取得する
     * @returns {Array} 進路一覧
     */
    getRoutes() {
        return this.routes;
    }
}

// グローバルスコープにエクスポート
window.RouteGenerator = RouteGenerator;
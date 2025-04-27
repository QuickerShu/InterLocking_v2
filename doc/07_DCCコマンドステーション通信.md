# DCCコマンドステーションとの通信
DCCコマンドステーションにはDesktopStationのDSAir2を用いる。DSAir2に挿入したFlashAirが構築するネットワーク（http://192.168.1.41/）に接続し、アプリからコマンドを送信してポイントなどを制御する。DSAir2との通信プロトコルは以下に示す。

## DSair Wi-Fi Specification
This page describes Wi-Fi interface specification of DSair2. DSair2 supports http REST like API. You can control DCC and Marklin locomotives and turnouts via http.

本ページでは、FlashAirベースで開発されたDSairに、ユーザーの皆様が開発・製作した機器やソフトウェアを接続してコントロールするための仕様を公開します。世界で唯一のオープンな無線・Wi-Fi対応のDCCコマンドステーションとして、活用いただければ幸いです。

ここに掲載した仕様・コマンドについて、ライセンスはございません。個人利用、クラブ利用、商用利用を含め、常識の範囲でご自由にお使い下さい。

### 接続方法
FlashAirカードにWi-Fiで接続してください。SSIDは、初期はFlashAir_（は任意の英数字）、パスワードは12345678です。FlashAir W-04においては電源投入後、10-20秒程度で、Wi-Fi接続が可能になります。DSairのアプリのConfig画面で、SSIDとパスワードは簡単に変更可能です。なお変更後は切断されます。SSIDとパスワードを変更した物に再設定してください。

同時接続モード(FlashAirがアクセスポイントにもなり、無線LANルータにも接続されるモード）の場合は、数分の時間が掛かる場合があります。

DSairへのコマンドの渡し方は、FlashAirのCGIコマンドの共有メモリアクセスを使用します。

注: DSairLiteではRaspberryPi PicoWをベースとしているため、FlashAirコマンドを模した機能をサーバーに実装しています。

DSair2の場合:
```
http://flashair/command.cgi?op=131&ADDR=0&LEN=64&DATA=DSair内部コマンド
```

DSairLiteの場合:
```
http://192.168.42.1/command.cgi?op=131&ADDR=0&LEN=64&DATA=DSair内部コマンド
```

DSair内部コマンドを変えることで、任意の命令をDSairに送って制御できます。

## DSairへの命令・コマンド

### 関数一覧/Function list

| Function | Command | Example | Notes |
|:---|:---|:---|:---|
| 線路電源,Power | PW(PowerFlag) | PW(1) | PW(0)で線路電源OFF、PW(1)でONです。 |
| 進行方向,Direction | DI(LocoAddr,Direction) | DI(49155,1) | |
| ファンクション,Function | FN(LocoAddr,FuncNo,FuncVal) | FN(59140,2,1) | |
| 車両速度,LocSpeed | SP(LocoAddr,Speed,Speedstep) | SP(59140,0,2) | |
| ポイント,Turnout | TO(AccAddr,AccDirection) | TO(14337,0) | |
| アナログ,AnalogPWM | DC(AnalogSpeed,AnalogDirection) | DC(300,2) | 線路電源OFFの時だけ使用可能。 |
| S88在線センサ,S88 Sensor | gS8() | gS8(1) | S88在線センサのデータ収集スタート |

| Parameters | Meanings | Notes |
|:---|:---|:---|
| PowerFlag | OFF=0, ON=1 | 線路電源の状態を切り替えます。 |
| Direction | FWD=1, REV=2 | 0はFWDと見なします。 |
| FuncNo | 0-28 | F0～F28に相当します |
| FuncVal | OFF=0, ON=1 | ファンクションの状態です。 |
| Speed | 0-1023 | 1023で最高速度です。512で50%です。 |
| Speedstep | 0-2 | DCCのとき128Stepは2です。MM2モードの時は0を指定してください。 |
| AccDirection | 分岐方向=0, 直進方向=1 | ポイントの切り替え方向です。 |
| AnalogSpeed | 0-1023 | アナログ電圧(スピード)。0が停止、1023が最大電圧です。 |
| AnalogDirection | 0 or 1:FWD, 2:REV | アナログの極性。0または1はFWD, 2はREVとなります。 |

Example of speed command is the follwoing.
DSairにコマンドを送る例としては、以下のようになります。
```
http://flashair/command.cgi?op=131&ADDR=0&LEN=64&DATA=SP(59140,0,2)
```

You can only send as HTTP GET command.
HTTP GETコマンドを送るだけです。

### コマンドの送信間隔
0.5秒(500ms)間隔程度で、コマンドを送信してください。他のWi-Fiデバイスからコマンドを同時に打ち込んだ場合、後着優先となります。

### Address meanings / アドレスの考え方
LocAddr and AccAddr define 16bit address space including DCC and Marklin Motorola2. This means you can control locootives and turnouts as 16bit address.

LocoAddr, AccAddrのアドレスには、DCCとメルクリンの二つのプロトコルを包含し、さらに車両とアクセサリもカバーした16bitのアドレス空間が定義されています。

| Address type range | Meaning | Notes |
|:---|:---|:---|
| Marklin Motorola 2 Locomotives | 0x0000-0x07FF | 0(0x0000) - 255(0x00FF) |
| DCC Locomtoives | 0xC000-0x1FFF | 0(0xC000) - 9999(0xE70F) |
| Marklin Motorola 2 accessory | 0x3000-0x37FF | 1(0x3000) - 320(0x3140) |
| DCC accessory | 0x3800-0x3FFF | 1(0x3800) - 2044(0x3FFC) |

実際にコマンドに使用する場合には、10進数に直して使用してください。たとえば0xC000→49152となります。

DCCアドレス３を動かす場合は、LocoAddrには49152+3=49155を指定すると、DCCアドレス３の車両が動きます。MM2アドレス３の場合は、LocoAddrには0+3=3を指定すると、MM2アドレス３の車両が動きます。

ポイントの場合は、0x3800(16進数)→14336(10進数)をオフセット値にして、DCCポイントアドレス５の場合は、14336-1+5=14340を指定すると、ポイントが切り替わります。ポイントの場合は1はじまりなので、-1しておくことが大事です。

### JavaScriptでの操作
jQueryを使用した場合は、以下のようなコードでコマンドを送信できます。

```javascript
function onChangeSpeed(inSpeed) {
  var url = "/command.cgi?op=131&ADDR=0&LEN=64&DATA=SP(49155," + inSpeed + ",2)";
  $.get(url, function (data) {});
}
```

## 状態・ステータスの読み出し

### 取得方法
共有メモリの128バイト目以降からサイズ264バイト(ASCII TEXT)に、制御状態や車両・ポイントデータが含まれているので、これを解析することで、制御状態を把握することができる。

```
/command.cgi?op=130&ADDR=128&LEN=264
N,0,0,0,155,00,2,22,00000000000;000000000000000;00000000000000000000000000000000000
00000000000000000000000000000;0000,00,0,00000000/0000,00,0,00000000/0000,00,0,00000
000/0000,00,0,00000000/0000,00,0,00000000/0000,00,0,00000000/0000,00,0,00000000/000
0,00,0,00000000
```

### パワーオン状態の確認
FlashAirの共有メモリのアドレス128にサイズ1のデータが格納されており、ここがYのときは線路電源ON、Nか0x00のときは線路電源OFFと判断します。

取得:
```
/command.cgi?op=130&ADDR=128&LEN=1
```

セット:
(setPowerコマンドで自動的にセットされます)

### ステータスデータの一覧
Status Data from DSair2(FlashAir shared memory) is ASCII text data.

データはすべててテキストである。S88データは、BASICからs88start命令が実行されると表示開始されます。実態は、gs8というコマンドをDSair2に送ると、S88機能が動作する流れになっています。

| IndexByte | Size | Parameter | Definition | Notes |
|:---|:---|:---|:---|:---|
| 0 | 1 | 線路電源 | ON="Y", OFF=0x00 | 線路の電源状態を示します |
| 1 | 1 | - | カンマ(,) | 区切り文字 |
| 2 | 1 | エラー番号 | | |
| 3 | 1 | - | カンマ(,) | 区切り文字 |
| 4 | 1 | FIRMWARE_VER | | |
| 5 | 1 | - | カンマ(,) | 区切り文字 |
| 6 | 1 | 制御車両数 | (0-15, 16進数) | |
| 7 | 1 | - | カンマ(,) | 区切り文字 |
| 8-10 | 3 | 線路電圧 | 120=12.0V | |
| 11 | 1 | - | カンマ(,) | 区切り文字 |
| 12-13 | 2 | 出力電流 | 10=1.0A | |
| 14 | 1 | - | カンマ(,) | 区切り文字 |
| 15 | 1 | ハードウェア Ver | | |
| 16 | 1 | - | カンマ(,) | 区切り文字 |
| 17-18 | 2 | 送信回数 | | |
| 19 | 1 | - | カンマ(,) | 区切り文字 |
| 20 | 1 | S88台数 | (1-2) | |
| 21 | 1 | S88データ1バイト目Low | S88デコーダ1台目(16bitの場合) | |
| 22 | 1 | S88データ1バイト目High | S88デコーダ1台目(16bitの場合) | |
| 23 | 1 | S88データ2バイト目Low | S88デコーダ1台目(16bitの場合) | |
| 24 | 1 | S88データ2バイト目High | S88デコーダ1台目(16bitの場合) | |
| 25 | 1 | S88データ3バイト目Low | S88デコーダ2台目(16bitの場合) | |
| 26 | 1 | S88データ3バイト目High | S88デコーダ2台目(16bitの場合) | |
| 27 | 1 | S88データ4バイト目Low | S88デコーダ2台目(16bitの場合) | |
| 28 | 1 | S88データ4バイト目High | S88デコーダ2台目(16bitの場合) | |
| 29 | 1 | S88データ予約 | | |
| 30 | 1 | S88データ予約 | | |
| 31 | 1 | 区切り | | |
| 32-46 | 15 | CV応答データ | (@CV,CVNo,Value,) | |
| 47 | 1 | 区切り | | |
| 48-111 | 64 | ポイント状態 | | |
| 112 | 1 | 区切り | | |
| 113- | 152 | 車両データ8台分 | LocAddr,Spd,Dir,Func | |
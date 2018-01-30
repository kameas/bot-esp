const wifi = require("Wifi");
const http = require("http");
const flash = new (require("FlashEEPROM"))();
const debug = true;
const dht = require("DHT22").connect(D4);

Object.defineProperty(Array.prototype, 'find', {
    enumerable: false,
    value: function (predicate) {
        var list = Object(this);
        var length = list.length >>> 0;
        var thisArg = arguments[1];
        var value;

        for (var i = 0; i < length; i++) {
            value = list[i];
            if (predicate.call(thisArg, value, i, list)) {
                return value;
            }
        }
        return undefined;
    }
});

const Adress = {
    wifi: 0,
    subs: 1,
    settings: 2
};

class Bot {
    constructor(options) {
        options = options || {
            humiditySet: 50,
            humOffset: 10
        };

        this._ssid = options.ssid;
        this._password = options.password;
        this._token = options.token;
        this._proxy = options.proxy;
        this._mosfetPin = options.mosfetPin;
        this._humiditySet = options.humiditySet;
        this._humOffset = options.humOffset;

        this._update_id = 0;

        this._status = false;
        this._timer = undefined;
        this._timerSet = 0;
        this._notifyEnable = true;
        this._status = false;
        this._listeners = [];

        this._reconnectTimer = undefined;

        this._temp = -1;
        this._humidity = -1;

        this.on = this.on.bind(this);
        this.off = this.off.bind(this);
        this.setTimer = this.setTimer.bind(this);
        this.applyTimer = this.applyTimer.bind(this);
        this.clearTimer = this.clearTimer.bind(this);
        this.timerLost = this.timerLost.bind(this);
        this.getTimer = this.getTimer.bind(this);
        this.setNotify = this.setNotify.bind(this);
        this.setHumidity = this.setHumidity.bind(this);
        this.getData = this.getData.bind(this);
        this.humidityWatcher = this.humidityWatcher.bind(this);
        this.checkUpdates = this.checkUpdates.bind(this);
        this.setListener = this.setListener.bind(this);
        this.removeListener = this.removeListener.bind(this);
        this.applyHumidity = this.applyHumidity.bind(this);
        this.readData = this.readData.bind(this);

        this._commands = {
            '/on': this.on,
            '/off': this.off,
            '/set_hum': this.setHumidity,
            '/set_timer': this.setTimer,
            '/set_notify': this.setNotify,
            '/get_data': this.getData,
        };
    }

    on(id) {
        digitalWrite(this._mosfetPin, true);
        this._status = true;

        if (id) {
            this.sendMessage(id, this.getStatus());
        }
    }

    off(id) {
        digitalWrite(this._mosfetPin, false);
        this._status = false;

        if (id) {
            this.sendMessage(id, this.getStatus());
        }
    }

    getStatus() {
        return `The humidifier is ${this._status ? 'on' : 'off'}`;
    }

    setTimer(id) {
        let message = `${this.getTimer()}, send time in minutes, 0 - turn off the timer`;
        this.setListener(id, this.applyTimer);
        this.sendMessage(id, message);
    }

    applyTimer(id, time) {
        time = parseInt(time);

        if (time === 0) {
            this.clearTimer();
        } else {
            let interval = time * 60 * 1000;
            this._timerSet = new Date(new Date().ms + interval).ms;
            this._timer = setTimeout(this.off, interval);
        }
        this.sendMessage(id, this.getTimer());
    }

    clearTimer() {
        clearTimeout(this._timer);
        this._timer = undefined;
    }

    timerLost() {
        return Math.round((new Date(this._timerSet).ms - new Date().ms) / 1000 / 60);
    }

    getTimer() {
        if (this._timer) {
            return `Timer is set to ${this.timerLost()} minutes`;
        } else {
            return `Timer is disabled`;
        }
    }

    setNotify(enable) {
        this._notifyEnable = enable;
        return this.getNotify();
    }

    getNotify() {
        return `Notifications ${this._notifyEnable ? 'enabled' : 'disabled'}`;
    }

    setHumidity(id) {
        let message = `The humidity level is set at ${this._humiditySet}, what level of humidity do you want?`;
        this.setListener(id, this.applyHumidity);
        this.sendMessage(id, message);
    }

    setListener(id, listener) {
        this._listeners.push({
            id,
            listener
        });
    }

    removeListener(id) {
        this._listeners = this._listeners.filter(element => {
            return element.id !== id;
        });
    }

    applyHumidity(id, percent) {
        this._humiditySet = percent;
        this.sendMessage(id, this.getHumidity());
    }

    getHumidity() {
        return `Humidity is set to ${this._humiditySet}%`;
    }

    getData(id) {
        this.readData(() => {
            let message = `Temp is ${this._temp},Humidity is ${this._humidity}`
            this.sendMessage(id, message);
        })
    }

    readData(callback) {
        dht.read((data) => {
            if (data.err) {
                debug && console.log('Error then try to check temp and hum');
            }

            this._temp = data.temp;
            this._humidity = data.rh;

            callback();
        });
    }

    humidityWatcher() {
        this.readData(() => {
            if (this._humidity > this._humiditySet) {
                this.off();
            } else if (this._humidity < this._humiditySet - this._humOffset) {
                this.on();
            }

            setTimeout(this.humidityWatcher, 5000);
        });
    }

    init() {
        setTimeout(this.humidityWatcher, 5000);

        this.handlers();
        this.connect();
    }

    handlers() {
        wifi.on('connected', details => {
            this.checkUpdates();

            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = undefined;

            debug && console.log(`Wifi is connected`);
        });

        wifi.on('disconnected', details => {
            debug && console.log(`Wifi is disconnected, ${details.reason}, try to reconnect`);

            this._reconnectTimer = setTimeout(this.connect, 1500);
        });
    }

    connect() {
        wifi.connect(this._ssid, {
            password: this._password
        });

        if (this._reconnectTimer) {
            this._reconnectTimer = setTimeout(this.connect, 1500);
        }
    }

    service(url, callback, error) {

        http.get(url, res => {
            let contents = "";

            res.on('data', data => {
                contents += data;
            });

            res.on('close', () => {
                let answer;

                try {
                    answer = JSON.parse(contents);
                } catch (err) {
                    error(err);
                    debug && console.log(err, contents);
                }

                if (!answer) return;

                callback(answer);

                debug && console.log(`Get data ${JSON.stringify(answer)} from ${url}`);
            });
        }).on('error', err => {
            debug && console.log(`Error then try to connect on ${url}`, err);

            error(err);
        });
    }

    checkUpdates() {
        const url = `${this._proxy}${encodeURIComponent(`https://api.telegram.org/bot${this._token}/getUpdates?offset=${this._update_id}`)}`;

        this.service(url, answer => {

            answer.result.forEach(element => {
                this._update_id = element.update_id + 1;

                this.parseMessage(element.message);
            });

            setTimeout(this.checkUpdates, 1500);
        }, error => {

            setTimeout(this.checkUpdates, 1500);
        });
    }

    parseMessage(message) {
        let text = message.text;
        let author = message.from.id;
        let listener = this._listeners.find(element => element.id == author);

        console.log('debug:')
        console.log(listener, this._listeners, text, author)

        if (listener) {
            if (~text.indexOf('/')) {
                this.removeListener(author);
                let answer = `Ok, the previous command was canceled`;
                this.sendMessage(author, answer, () => {
                    this.parseMessage(message);
                });
                
            } else {
                listener.listener(author, text);
                this.removeListener(author);
            }
        } else {

            for (let command in this._commands) {
                if (command === text) {
                    if (typeof this._commands[command] === 'function') {
                        this._commands[command](author);
                    }
                }
            }
        }
    }

    

    sendMessage(id, message, callback) {
        debug && console.log(`Try send message: ${message} to ${id}`);

        const url = `${this._proxy}${encodeURIComponent(`https://api.telegram.org/bot${this._token}/sendMessage?chat_id=${id}&text=${message}`)}`;

        this.service(url, answer => {
            debug && console.log(`Sucscess send message: ${answer.result.text} to ${id}`);

            if(typeof callback === 'function') {
                callback();
            }
        }, err => {
            debug && console.log(`Failed send message: ${message} to ${id}, ${err}, url is: ${url}`);
        });
    }
}

const connect = () => {
    const { ssid, password } = JSON.parse(E.toString(flash.read(Adress.wifi)));
    const { token, proxy, mosfetPin, humiditySet, humOffset } = JSON.parse(E.toString(flash.read(Adress.settings)));

    const bot = new Bot({
        ssid,
        password,
        token,
        proxy,
        mosfetPin,
        humiditySet,
        humOffset
    });

    bot.init();
};

const setWifi = (ssid, password) => {
    flash.write(Adress.wifi, JSON.stringify({
        ssid,
        password
    }));

    debug && console.log(`Set wifi setttings: ${E.toString(flash.read(Adress.wifi))} to addr: ${Adress.wifi}`);
};

const setSettings = settings => {
    flash.write(Adress.settings, JSON.stringify(settings));

    debug && console.log(`Set setttings: ${E.toString(flash.read(Adress.settings))} to addr: ${Adress.settings}`);
};
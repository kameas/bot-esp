const wifi = require("Wifi");
const http = require("http");
const flash = new (require("FlashEEPROM"))();
const debug = true;
const dht = require("DHT22").connect(D4);

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

        this._reconnectTimer = undefined;

        this._temp = -1;
        this._humidity = -1;

        this.on = this.on.bind(this);
        this.off = this.off.bind(this);
        this.setTimer = this.setTimer.bind(this);
        this.setNotify = this.setNotify.bind(this);
        this.setHumidity = this.setHumidity.bind(this);
        this.getData = this.getData.bind(this);
        this.humidityWatcher = this.humidityWatcher.bind(this);
        this.checkUpdates = this.checkUpdates.bind(this);

        this._commands = {
            '/on': this.on,
            '/off': this.off,
            '/set_timer': this.setTimer,
            '/set_notify': this.setNotify,
            '/set_hum': this.setHumidity,
            '/get_data': this.getData,
        };
    }

    on(id) {
        digitalWrite(this._mosfetPin, true);
        this._status = true;
        this.sendMessage(id, this.getStatus());
    }

    off(id) {
        digitalWrite(this._mosfetPin, false);
        this._status = false;
        this.sendMessage(id, this.getStatus());
    }

    getStatus() {
        return `The humidifier is ${this._status ? 'on' : 'off'}`;
    }

    setTimer(time) {
        this._timer = setTimeout(this.off, time);
        this._timerSet = time;
        return this.getTimer();
    }

    clearTimer() {
        clearTimeout(this._timer);
        this._timer = undefined;
        return this.getTimer();
    }

    timerLost() {
        return new Date() - new Date(this._timerSet);
    }

    getTimer() {
        if (this._timer) {
            return `Timer the timer is set to ${this._timerLost() / 1000 / 60} minutes`;
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

    setHumidity(percent) {
        this._humiditySet = percent;
        return this.getHumidity();
    }

    getHumidity() {
        return `Humidity is set to ${this._humiditySet}%`;
    }

    getData() {
        return `Temp is ${this._temp}, Humidity is ${this._humidity}`;
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
                    debug && console.log(err, contents);
                }

                if (!answer) return;

                callback(answer);

                debug && console.log(`Get data ${answer} from ${url}`);
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

        for (let command in this._commands) {
            if (command === text) {
                if (typeof this._commands[command] === 'function') {
                    this._commands[command](author);
                }
            }
        }
    }

    sendMessage(id, message) {
        const url = `${this._proxy}${encodeURIComponent(`https://api.telegram.org/bot${this._token}/sendMessage?chat_id=${id}&text=${message}`)}`;

        this.service(url, answer => {
            debug && console.log(`Sucscess send message: ${answer.result.text} to ${id}`);
        }, err => {
            debug && console.log(`Failed send message: ${message} to ${id}, ${err}`);
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
var wifi = require("Wifi");
var http = require("http");
let lastId = 0;
let hum = 0;

wifi.connect(SSID, {
    password: PASSWORD
}, function (err) {
    if (err) {
        console.log(err);
    } else {
        console.log("connected!");
        let url = `https://api.telegram.org/bot${token}/`;
        let method = 'getUpdates';

        setTimeout(checker, 1500, `${proxy}${url}${method}`);

        /*    http.get(`${proxy}${url}${method}${makeQueryString(params)}`, function(res) {
              var contents = "";
              res.on('data', function(data) { contents += data; });
              res.on('close', function() {
                console.log(contents);

                console.log('url:', `${proxy}${url}${method}${makeQueryString(params)}`);
              });
            }).on('error', function(e) {
              console.log("ERROR", e);
            });*/
    }
});

let checker = url => {
    let params = {
        offset: lastId
    };
    console.log(`get url: ${url}${makeQueryString(params)}`);

    http.get(`${url}${makeQueryString(params)}`, function (res) {
        var contents = "";
        res.on('data', function (data) {
            contents += data;
        });
        res.on('close', function () {
            var obj = JSON.parse(contents);
            if (obj.result[0]) {
                lastId = obj.result[0].update_id + 1;
                console.log('lastId how is:', lastId);
                hum = obj.result[0].message.text * 1;
                console.log('hum how is:', hum);
            }

            setTimeout(checker, 1500, url);
        });
    }).on('error', function (e) {
        console.log("ERROR", e);
    });
};

let makeQueryString = params => {
    let string = '%3F';

    for (let param in params) {
        string += `${param}=${params[param]}%26`;
    }

    let remover = string.replace(' ', '+').split('');
    remover[remover.length - 1] = '';
    remover[remover.length - 2] = '';
    remover[remover.length - 3] = '';
    return remover.join('');
};

let send = url => {
    http.get(url, function (res) {
        var contents = "";
        res.on('data', function (data) {
            contents += data;
        });
        res.on('close', function () {
            console.log(contents);
        });
    }).on('error', function (e) {
        console.log("ERROR", e);
    });
};

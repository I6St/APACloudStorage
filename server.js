const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const https = require('https');
const { unescape } = require('querystring');

function log(status, message) {
    const logMessage = `[${new Date().toLocaleString()} ${status}] ${message}`;
    console.log(logMessage);
    fs.appendFileSync('acs.log', logMessage + '\n');
}

let inviteCodes = [];

const emojiRegex = /([\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{2600}-\u{26FF}])/gu;

function extractEmojis(text) {
    return text.match(emojiRegex) || [];
}

function includesEmoji(text) {
    return extractEmojis(text).length > 0;
}

function encodeBase64(str) {
    return Buffer.from(str).toString('base64');
}

function decodeBase64(str) {
    return Buffer.from(str, 'base64').toString('utf8');
}



const app = express();
const port = 1145;
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));


const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, './files/');
    },
    filename: function (req, file, cb) {
        cb(null, `${file.fieldname}`);
    },
    limits: {
        fileSize: 1.75 * 1000 * 1000 * 1000
    }
});

const upload = multer({ storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


app.get('/upload', (req, res) => {
    res.render('upload', { ip: req.ip, maxSize: 1.75 });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!fs.existsSync(path.join(__dirname, 'userdata', req.body.username))) {
        res.sendFile(path.join(__dirname, 'public', 'user-not-found.html'));
        return;
    }
    const userInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'userdata', req.body.username, 'info.json')));
    if (userInfo.password !== req.body.password) {
        res.sendFile(path.join(__dirname, 'public', 'pwd.html'));
        return;
    }
    const file = req.file;
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    if (!file) {
        res.sendFile(path.join(__dirname, 'public', 'bad-request.html'));
        return;
    }
    const fileName = originalName;
    if (!fs.existsSync(path.join(__dirname, 'files', req.body.username))) {
        fs.mkdirSync(path.join(__dirname, 'files', req.body.username));
    }
    const filePath = path.join(__dirname, 'files', req.body.username, fileName);
    fs.renameSync(file.path, filePath);
    log('INFO', `用户 ${req.body.username} 上传文件 ${fileName}`);
    const shareLink = `${getFormattedHost(req)}/share/${encodeBase64(`${req.body.username}/${fileName}`)}`;
    const downloadLink = `${getFormattedHost(req)}/download/${encodeBase64(`${req.body.username}/${fileName}`)}`;
    res.send(`<html lang="zh-CN">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>文件上传成功 | APACloudStorage</title>
            <style>
                body {
                    text-align: center;
                }
                button {
                    margin: 10px;
                    padding: 10px 20px;
                }
            </style>
        </head>
        <body>
        <h1>文件上传成功</h1>
        <p>用户名: ${req.body.username}</p>
        <p>文件名: ${fileName}</p>
        
        <p>下载直链 (进入 '我的文件' 查看): ${'*'.repeat(downloadLink.length)}</p>
        <p>分享链接: <a href="${shareLink}" target="_blank">${shareLink}</a></p>
        <button onclick="location.href='/upload'">继续上传文件</button>
        <button onclick="location.href='/my-files'">查看我的文件</button>
        <hr><footer>&copy; APACloudStorage 2026. 保留所有权利。</footer>
        </body>
</html>`);
});

app.get('/register', (req, res) => {
    res.render('register', { ip: req.ip });
});

app.post('/api/register', (req, res) => {
    log('INFO', `用户 ${req.body.username} 尝试注册`);
    const { username, email, password, inviteCode } = req.body;
    if (!username || !email || !password || !inviteCode) {
        res.sendFile(path.join(__dirname, 'public', 'bad-request.html'));
        return;
    }
    inviteCodes = JSON.parse(fs.readFileSync('inviteCodes.json'));
    if (!inviteCodes.includes(inviteCode)) {
        res.sendFile(path.join(__dirname, 'public', 'invaild-invite.html'));
        return;
    }
    if (fs.existsSync(path.join(__dirname, 'userdata', username))) {
        res.sendFile(path.join(__dirname, 'public', 'user-exists.html'));
        return;
    }
    log('INFO', `创建用户 ${username} 目录`);
    fs.mkdirSync(path.join(__dirname, 'userdata', username));
    fs.writeFileSync(path.join(__dirname, 'userdata', username, 'info.json'), JSON.stringify({
        username,
        email,
        password,
        inviteCode
    }));
    log('INFO', `用户 ${username} 注册成功`);
    log('INFO', `用户 ${username} 注册邮箱: ${email} 密码: ${password} 邀请码: ${inviteCode}`);
    res.send(`<html lang="zh-CN">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>注册成功 | APACloudStorage</title>
            <style>
                body {
                    text-align: center;
                }
                button {
                    margin: 10px;
                    padding: 10px 20px;
                }
            </style>
        </head>
        <body>
        <h1>注册成功</h1>
        <p>用户名: ${username}</p>
        <p>邮箱: ${email}</p>
        <p>密码: ${'*'.repeat(password.length)}</p>
        <p>邀请码: ${'*'.repeat(inviteCode.length)}</p>
        <hr><footer>&copy; APACloudStorage 2026. 保留所有权利。</footer>
    </body>
</html>`);
})

app.get('/login', (req, res) => {
    log('INFO', `渲染登录页面`);
    res.render('login', { ip: req.ip });
});

app.post('/api/login', (req, res) => {
    log('INFO', `用户 ${username} 尝试登录`);
    const { username, password } = req.body;
    if (!username || !password) {
        res.sendFile(path.join(__dirname, 'public', 'bad-request.html'));
        return;
    }
    if (!fs.existsSync(path.join(__dirname, 'userdata', username))) {
        res.sendFile(path.join(__dirname, 'public', 'user-not-found.html'));
        return;
    }
    const userInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'userdata', username, 'info.json')));
    if (userInfo.password !== password) {
        res.sendFile(path.join(__dirname, 'public', 'pwd.html'));
        return;
    }
    log('INFO', `用户 ${username} 登录成功`);
    res.send(`<html lang="zh-CN">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>登录成功 | APACloudStorage</title>
            <style>
                body {
                    text-align: center;
                }
                button {
                    margin: 10px;
                    padding: 10px 20px;
                }
            </style>
        </head>
        <body>
        <h1>登录成功</h1>
        <p>用户名: ${username}</p>
        <p>密码: ${password}</p>
        <hr><footer>&copy; APACloudStorage 2026. 保留所有权利。</footer>
    </body>
</html>`);
})

app.get('/change-password', (req, res) => {
    log('INFO', `渲染修改密码页面`);
    res.render('change-password', { ip: req.ip });
});

app.post('/api/change-password', (req, res) => {
    const { username, oldPassword, newPassword } = req.body;
    if (!username || !oldPassword || !newPassword) {
        res.sendFile(path.join(__dirname, 'public', 'bad-request.html'));
        return;
    }
    if (!fs.existsSync(path.join(__dirname, 'userdata', username))) {
        res.sendFile(path.join(__dirname, 'public', 'user-not-found.html'));
        return;
    }
    const userInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'userdata', username, 'info.json')));
    if (userInfo.password !== oldPassword) {
        res.sendFile(path.join(__dirname, 'public', 'pwd.html'));
        return;
    }
    userInfo.password = newPassword;
    fs.writeFileSync(path.join(__dirname, 'userdata', username, 'info.json'), JSON.stringify(userInfo));
    log('INFO', `用户 ${username} 修改密码为 ${newPassword}`);
    res.send(`<html lang="zh-CN">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>密码修改成功 | APACloudStorage</title>
            <style>
                body {
                    text-align: center;
                }
                button {
                    margin: 10px;
                    padding: 10px 20px;
                }
            </style>
        </head>
        <body>
        <h1>密码修改成功</h1>
        <p>用户名: ${username}</p>
        <p>新密码: ${'*'.repeat(newPassword.length)}</p>
        <hr><footer>&copy; APACloudStorage 2026. 保留所有权利。</footer>
    </body>
</html>`);
});

app.get('/delete', (req, res) => {
    log('INFO', `渲染删除文件页面`);
    res.render('delete', { ip: req.ip });
});

app.post('/api/delete', (req, res) => {
    const { username, password, filename } = req.body;
    if (!username || !password || !filename) {
        res.sendFile(path.join(__dirname, 'public', 'bad-request.html'));
        return;
    }
    if (!fs.existsSync(path.join(__dirname, 'userdata', username))) {
        res.sendFile(path.join(__dirname, 'public', 'user-not-found.html'));
        return;
    }
    const userInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'userdata', username, 'info.json')));
    if (userInfo.password !== password) {
        res.sendFile(path.join(__dirname, 'public', 'pwd.html'));
        return;
    }
    const filePath = path.join(__dirname, 'files', username, filename);
    if (!fs.existsSync(filePath)) {
        res.sendFile(path.join(__dirname, 'public', 'file-not-found.html'));
        return;
    }
    fs.unlinkSync(filePath);
    log('INFO', `用户 ${username} 删除文件: ${filename}`);
    res.send('<script>window.close();</script>');
})

app.get('/my-files', (req, res) => {
    res.render('my-files', { ip: req.ip });
});

app.post('/api/my-files', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        res.sendFile(path.join(__dirname, 'public', 'bad-request.html'));
        return;
    }
    if (!fs.existsSync(path.join(__dirname, 'userdata', username))) {
        res.sendFile(path.join(__dirname, 'public', 'user-not-found.html'));
        return;
    }
    const userInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'userdata', username, 'info.json')));
    if (userInfo.password !== password) {
        res.sendFile(path.join(__dirname, 'public', 'pwd.html'));
        return;
    }
    if (!fs.existsSync(path.join(__dirname, 'files', username))) {
        fs.mkdirSync(path.join(__dirname, 'files', username));
        return;
    }
    let fileName;
    log('INFO', `用户 ${username} 获取文件列表`);
    res.send(`<html lang="zh-CN">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>我的文件 | APACloudStorage</title>
            <style>
                body {
                    text-align: center;
                }
                button {
                    margin: 10px;
                    padding: 10px 20px;
                }
            </style>
        </head>
        <body>
        <h1>我的文件</h1>
        <p>${req.ip}，欢迎你</p>
        <p>用户名: ${username}</p>
        <ul>
        <p>${(function () {
            const files = fs.readdirSync(path.join(__dirname, 'files', username));
            return files.map(fileName => {
                const sharePath = encodeBase64(`${username}/${fileName}`);
                return `<li>${fileName} <button onclick="if (confirm('确定要删除文件 ${fileName} 吗？')) window.open('/delete-file/${username}/${password}/${fileName}');location.reload()">删除</button> <button onclick="window.open('/download/${sharePath}')">下载</button> <button onclick="window.open('/share/${sharePath}')">打开分享链接</button></li>`
            }).join('');
        })()}</p>
        </ul>
        <button onclick="location.reload()">刷新</button>
        <button onclick="location.href='/upload'">上传文件</button>
        <hr><footer>&copy; APACloudStorage 2026. 保留所有权利。</footer>
        </body>
    </html>`);
})

app.get('/download/:path', (req, res) => {
    const [username, filename] = decodeBase64(req.params.path).split('/');
    
    if (!fs.existsSync(path.join(__dirname, 'userdata', username))) {
        res.sendFile(path.join(__dirname, 'public', 'user-not-found.html'));
        return;
    }
    if (!fs.existsSync(path.join(__dirname, 'files', username, filename))) {
        res.sendFile(path.join(__dirname, 'public', 'file-not-found.html'));
        return;
    }
    res.download(path.join(__dirname, 'files', username, filename));
});

app.get('/delete-file/:username/:password/:filename', (req, res) => {
    const filePath = path.join(__dirname, 'files', req.params.username, req.params.filename);
    if (!fs.existsSync(path.join(__dirname, 'userdata', req.params.username))) {
        res.sendFile(path.join(__dirname, 'public', 'user-not-found.html'));
        return;
    }
    const userInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'userdata', req.params.username, 'info.json')));
    if (userInfo.password !== req.params.password) {
        res.sendFile(path.join(__dirname, 'public', 'pwd.html'));
        return;
    }
    if (!fs.existsSync(filePath)) {
        res.sendFile(path.join(__dirname, 'public', 'file-not-found.html'));
        return;
    }
    fs.unlinkSync(filePath);
    log('INFO', `删除文件: ${filePath}`);
    res.send('<script>window.close();</script>');
})

app.get('/about', (req, res) => {
    res.render('about', { ip: req.ip });
});

/**
 * 获取格式化后的主机名（端口为默认值时隐藏）
 * @param {Object} req - Express 请求对象
 * @returns {string} 格式化后的主机名
 */
function getFormattedHost(req) {
    // // 1. 获取包含端口的完整主机头，例如 "example.com:3000" 或 "example.com"
    // const hostHeader = req.get('host');

    // if (!hostHeader) {
    //     return req.hostname || 'unknown';
    // }

    // // 2. 分离主机名和端口
    // const [hostname, portStr] = hostHeader.split(':');
    // const port = parseInt(portStr, 10);

    // // 3. 判断是否为默认端口，决定是否显示端口
    // const isDefaultPort = (port === 80 && req.protocol === 'http') ||
    //     (port === 443 && req.protocol === 'https');

    // return isDefaultPort ? hostname : hostHeader;
    return 'strg.apakp.top';
}

app.get('/q', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'q.html'));
});

app.get('/share/:path', (req, res) => {
    log('INFO', `[${new Date().toLocaleString()} ${req.method} ${req.url} ${req.ip} ${req.headers['user-agent']} ${req.headers['accept-language']} INFO ${req.ip}] 获取分享文件`);
    log('INFO', req.params.path);
    log('INFO', atob(req.params.path));
    const originalPath = decodeBase64(req.params.path).split('/')[1];
    const username = decodeBase64(req.params.path).split('/')[0];
    const filePath = path.join(__dirname, 'files', username, originalPath);
    const fileName = path.basename(filePath);
    if (!fs.existsSync(filePath)) {
        log('ERROR', `文件不存在: ${filePath}`);
        res.sendFile(path.join(__dirname, 'public', 'file-not-found.html'));
        return;
    }
    const sharePath = encodeBase64(`${username}/${fileName}`);
    log('INFO', `渲染分享文件页面: ${username}/${originalPath}`);
    res.render('share', { sharePath: sharePath, username: username, fileName: fileName });
});

const privateKey = fs.readFileSync('private.key');
const certificate = fs.readFileSync('certificate.crt');
const httpsServer = https.createServer({ key: privateKey, cert: certificate }, app);
httpsServer.listen(port, () => {
    if (!fs.existsSync('files')) {
        fs.mkdirSync('files');
    }
    if (!fs.existsSync('userdata')) {
        fs.mkdirSync('userdata');
    }
    if (!fs.existsSync('inviteCodes.json')) {
        fs.writeFileSync('inviteCodes.json', JSON.stringify(['ADMIN-INVITE-CODE']));
        log('INFO', '邀请码文件已创建，初始邀请码为: ADMIN-INVITE-CODE');
    }
    if (!fs.existsSync('acs.log')) {
        fs.writeFileSync('acs.log', '');
        log('INFO', '日志文件已创建');
    }
    inviteCodes = JSON.parse(fs.readFileSync('inviteCodes.json'));
    log('INFO', `HTTPS 服务器运行在 https://localhost:${port}`);
});


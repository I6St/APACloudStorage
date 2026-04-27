const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const https = require('https');


let inviteCodes = [];

const app = express();
const port = 3000;
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// const storage = multer.diskStorage({
//     destination: 'files',
//     filename: (req, file, cb) => {
//         // 核心修复：将被错误解码的文件名重新转换为正确的 UTF-8 编码
//         file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
//         cb(null, true);
//     },
//     filename: (req, file, cb) => {
//         cb(null, 'files/');
//     },
//     filename: (req, file, cb) => {
//         const extname = path.extname(file.originalname);
//         cb(null, Date.now() + '-' + file.originalname + extname);
//     },
//     limits: {
//         fileSize: 1.5 * 1000 * 1000 * 1000
//     }
// });

// const storage = multer.diskStorage({
//     destination: (req, file, cb) => {
//         cb(null, 'files/');
//     },
//     fileFilter: (req, file, cb) => {
//         // 核心修复：手动纠正文件名编码
//         file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
//         cb(null, true);
//     },
//     filename: (req, file, cb) => {
//         // 核心修复：解码后再保存
//         const correctName = Buffer.from(file.originalname, 'latin1').toString('utf8');
//         cb(null, correctName);
//     }
// });

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
    const file = req.file;
    if (!file) {
        res.sendFile(path.join(__dirname, 'public', 'bad-request.html'));
        return;
    }
    if (!fs.existsSync(path.join(__dirname, 'userdata', req.body.username))) {
        res.sendFile(path.join(__dirname, 'public', 'user-not-found.html'));
        return;
    }
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const userInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'userdata', req.body.username, 'info.json')));
    if (userInfo.password !== req.body.password) {
        res.sendFile(path.join(__dirname, 'public', 'pwd.html'));
        return;
    }
    const fileName = originalName;
    if (!fs.existsSync(path.join(__dirname, 'files', req.body.username))) {
        fs.mkdirSync(path.join(__dirname, 'files', req.body.username));
    }
    const filePath = path.join(__dirname, 'files', req.body.username, fileName);
    fs.renameSync(file.path, filePath);
    res.send(`<h1>文件上传成功</h1>
        <p>用户名: ${req.body.username}</p>
        <p>文件名: ${fileName}</p>
        <p>访问直链: <a href="${getFormattedHost(req)}/files/${req.body.username}/${fileName}">${getFormattedHost(req)}/${req.body.username}/${fileName}</a></p>
        <p>下载直链: <a href="/download/${req.body.username}/${fileName}">${getFormattedHost(req)}/download/${req.body.username}/${fileName}</a></p>
        <p>分享链接: <a href="/share/${req.body.username}/${fileName}" target="_blank">${getFormattedHost(req)}/share/${req.body.username}/${fileName}</a></p>
        <a href="/">返回主页</a>`);
});

app.get('/register', (req, res) => {
    res.render('register', { ip: req.ip });
});

app.post('/api/register', (req, res) => {
    console.log(req.body);
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
    fs.mkdirSync(path.join(__dirname, 'userdata', username));
    fs.writeFileSync(path.join(__dirname, 'userdata', username, 'info.json'), JSON.stringify({
        username,
        email,
        password,
        inviteCode
    }));

    res.send(`<h1>注册成功</h1>
        <p>用户名: ${username}</p>
        <p>邮箱: ${email}</p>
        <p>密码: ${'*'.repeat(password.length)}</p>
        <p>邀请码: ${'*'.repeat(inviteCode.length)}</p>
        <a href="/">返回主页</a>
    </>`);
})

app.get('/login', (req, res) => {
    res.render('login', { ip: req.ip });
});

app.post('/api/login', (req, res) => {
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
    res.send(`<h1>登录成功</h1>
        <p>用户名: ${username}</p>
        <p>密码: ${password}</p>
        <a href="/">返回主页</a>
    </>`);
})

app.get('/change-password', (req, res) => {
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
    res.send(`<h1>密码修改成功</h1>
        <p>用户名: ${username}</p>
        <p>新密码: ${'*'.repeat(newPassword.length)}</p>
        <a href="/">返回主页</a>
    </>`);
});

app.get('/delete', (req, res) => {
    res.render('delete', { ip: req.ip });
});

app.post('/api/delete', (req, res) => {
    const { username, password, filename } = req.body;
    if (!username || !password || !filename) {
        res.sendFile(path.join(__dirname, 'public', 'bad-request.html'));
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
    res.sendFile(path.join(__dirname, 'public', 'ok.html'));
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
    const userInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'userdata', username, 'info.json')));
    if (userInfo.password !== password) {
        res.sendFile(path.join(__dirname, 'public', 'pwd.html'));
        return;
    }
    let fileName;
    res.send(`<h1>文件列表</h1>
        <ul>
        <p>${(function () {
            const files = fs.readdirSync(path.join(__dirname, 'files', username));
            return files.map(fileName => `<li>${fileName} <a href="/delete-file/${username}/${password}/${fileName}">删除</a> <a href="/download/${username}/${fileName}">下载</a> <a href="/share/${username}/${fileName}" target="_blank">打开分享链接</a></li>`).join('');
        })()}</p>
        </ul>
        <a href="javascript:location.reload()">刷新</a>
        <a href="/">返回主页</a>
    </>`);
})

app.get('/download/:username/:filename', (req, res) => {
    res.download(path.join(__dirname, 'files', req.params.username, req.params.filename));
});

app.get('/delete-file/:username/:password/:filename', (req, res) => {
    const filePath = path.join(__dirname, 'files', req.params.username, req.params.filename);
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
    res.sendFile(path.join(__dirname, 'public', 'ok.html'));
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
    // 1. 获取包含端口的完整主机头，例如 "example.com:3000" 或 "example.com"
    const hostHeader = req.get('host');

    if (!hostHeader) {
        return req.hostname || 'unknown';
    }

    // 2. 分离主机名和端口
    const [hostname, portStr] = hostHeader.split(':');
    const port = parseInt(portStr, 10);

    // 3. 判断是否为默认端口，决定是否显示端口
    const isDefaultPort = (port === 80 && req.protocol === 'http') ||
        (port === 443 && req.protocol === 'https');

    return isDefaultPort ? hostname : hostHeader;
}

app.get('/share/:username/:filename', (req, res) => {
    res.render('share', { username: req.params.username, fileName: req.params.filename });
});

const privateKey = fs.readFileSync('private.key');
const certificate = fs.readFileSync('certificate.crt');
const httpsServer = https.createServer({ key: privateKey, cert: certificate }, app);
httpsServer.listen(443, () => {
    if (!fs.existsSync('files')) {
        fs.mkdirSync('files');
    }
    if (!fs.existsSync('userdata')) {
        fs.mkdirSync('userdata');
    }
    if (!fs.existsSync('inviteCodes.json')) {
        fs.writeFileSync('inviteCodes.json', JSON.stringify(['ADMIN-INVITE-CODE']));
        console.log('邀请码文件已创建，初始邀请码为: ADMIN-INVITE-CODE');
    }
    inviteCodes = JSON.parse(fs.readFileSync('inviteCodes.json'));
    console.log('HTTPS 服务器运行在 https://localhost:443');
});


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
    return encodeURIComponent(Buffer.from(str).toString('base64'));
}

function decodeBase64(str) {
    return Buffer.from(decodeURIComponent(str), 'base64').toString('utf8');
}

function generateToken() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 16; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
}

function getShareFilePath(token) {
    return path.join(__dirname, 'shared', token + '.json');
}

function findShareByItem(username, itemPath, isFolder) {
    if (!fs.existsSync(path.join(__dirname, 'shared'))) {
        return null;
    }
    const files = fs.readdirSync(path.join(__dirname, 'shared'));
    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const sharePath = path.join(__dirname, 'shared', file);
        const share = JSON.parse(fs.readFileSync(sharePath));
        const isFolderBool = isFolder === '1' || isFolder === true || isFolder === 'true';
        if (share.username === username && share.itemPath === itemPath && share.isFolder === isFolderBool) {
            return { token: file.replace('.json', ''), share: share };
        }
    }
    return null;
}

function scanDirForShare(dir, base) {
    const files = [];
    const items = fs.readdirSync(dir);
    items.forEach(item => {
        const full = path.join(dir, item);
        const rel = base ? base + '/' + item : item;
        if (fs.statSync(full).isDirectory()) {
            scanDirForShare(full, rel).forEach(f => files.push(f));
        } else {
            files.push({ name: item, path: rel });
        }
    });
    return files;
}

function copyFolderRecursive(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    const items = fs.readdirSync(src);
    items.forEach(item => {
        const s = path.join(src, item);
        const d = path.join(dst, item);
        if (fs.statSync(s).isDirectory()) {
            copyFolderRecursive(s, d);
        } else {
            fs.copyFileSync(s, d);
        }
    });
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
        cb(null, `${Date.now()}_${file.fieldname}`);
    },
    limits: {
        fileSize: 1.25 * 1000 * 1000 * 1000
    }
});

const upload = multer({ storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/upload', (req, res) => {
    const folderPath = req.query.folder || '';
    res.render('upload', { ip: req.ip, maxSize: 1.25, folderPath: folderPath });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
    const file = req.file;
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const folderPath = req.body.folderPath || '';
    if (!fs.existsSync(path.join(__dirname, 'userdata', req.body.username))) {
        fs.unlinkSync(file.path);
        res.sendFile(path.join(__dirname, 'public', 'user-not-found.html'));
        return;
    }
    const userInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'userdata', req.body.username, 'info.json')));
    if (userInfo.password !== req.body.password) {
        fs.unlinkSync(file.path);
        res.sendFile(path.join(__dirname, 'public', 'pwd.html'));
        return;
    }
    if (!file) {
        fs.unlinkSync(file.path);
        res.sendFile(path.join(__dirname, 'public', 'bad-request.html'));
        return;
    }
    const userDir = path.join(__dirname, 'files', req.body.username);
    const targetDir = path.join(userDir, folderPath);
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
    const filePath = path.join(targetDir, originalName);
    fs.renameSync(file.path, filePath);
    log('INFO', `用户 ${req.body.username} 上传文件 ${originalName} 到 ${folderPath || '根目录'}`);
    const relativePath = folderPath ? `${folderPath}/${originalName}` : originalName;
    const shareLink = `https://${getFormattedHost(req)}/share/${encodeBase64(`${req.body.username}/${relativePath}`)}`;
    const downloadLink = `https://${getFormattedHost(req)}/download/${encodeBase64(`${req.body.username}/${relativePath}`)}`;
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
        <p>文件名: ${originalName}</p>
        <p>文件夹: ${folderPath || '根目录'}</p>
        <p>下载直链 (进入 '我的文件' 查看): ${'*'.repeat(downloadLink.length)}</p>
        <p>分享链接: <a href="${shareLink}" target="_blank">${shareLink}</a></p>
        <button onclick="location.href='/upload'">继续上传文件</button>
        <button onclick="location.href='/my-files'">查看我的文件</button>
        <hr><footer>&copy; APACloudStorage 2026. 保留所有权利。</footer>
        <script>localStorage.setItem('acs_username', '${req.body.username}'); localStorage.setItem('acs_password', '${req.body.password}');</script>
        </body>
    </html>`);
});

app.post('/api/create-folder', (req, res) => {
    const { username, password, folderName, currentFolder } = req.body;
    if (!username || !password || !folderName) {
        return res.json({ success: false, error: '缺少必要参数' });
    }
    if (!fs.existsSync(path.join(__dirname, 'userdata', username))) {
        return res.json({ success: false, error: '用户不存在' });
    }
    const userInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'userdata', username, 'info.json')));
    if (userInfo.password !== password) {
        return res.json({ success: false, error: '密码错误' });
    }
    const targetDir = path.join(__dirname, 'files', username, currentFolder || '', folderName);
    if (fs.existsSync(targetDir)) {
        return res.json({ success: false, error: '文件夹已存在' });
    }
    fs.mkdirSync(targetDir, { recursive: true });
    log('INFO', `用户 ${username} 创建文件夹 ${currentFolder ? currentFolder + '/' : ''}${folderName}`);
    res.json({ success: true });
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
    if (!fs.existsSync(path.join(__dirname, 'files', username))) {
        fs.mkdirSync(path.join(__dirname, 'files', username));
    }
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
    const { username, password } = req.body;
    log('INFO', `用户 ${username} 尝试登录`);
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
        <button onclick="localStorage.setItem('acs_username', '${username}'); localStorage.setItem('acs_password', '${password}'); location.href='/my-files'">进入我的文件</button>
        <button onclick="localStorage.setItem('acs_username', '${username}'); localStorage.setItem('acs_password', '${password}'); location.href='/upload'">上传文件</button>
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
    const { username, password, folderPath } = req.body;
    if (!username || !password) {
        return res.json({ error: '缺少用户名或密码' });
    }
    if (!fs.existsSync(path.join(__dirname, 'userdata', username))) {
        return res.json({ error: '用户不存在' });
    }
    const userInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'userdata', username, 'info.json')));
    if (userInfo.password !== password) {
        return res.json({ error: '密码错误' });
    }
    const userDir = path.join(__dirname, 'files', username);
    const currentDir = path.join(userDir, folderPath || '');
    if (!fs.existsSync(currentDir)) {
        fs.mkdirSync(currentDir, { recursive: true });
    }
    let items;
    try {
        items = fs.readdirSync(currentDir);
    } catch (e) {
        return res.json({ error: '无法读取目录' });
    }
    const folders = [];
    const files = [];
    items.forEach(item => {
        const itemPath = path.join(currentDir, item);
        const stat = fs.statSync(itemPath);
        if (stat.isDirectory()) {
            folders.push(item);
        } else {
            files.push(item);
        }
    });
    const breadcrumb = folderPath ? folderPath.split('/').filter(Boolean) : [];
    const parentFolder = folderPath ? folderPath.split('/').slice(0, -1).join('/') : null;
    log('INFO', `用户 ${username} 获取文件列表，当前目录: ${folderPath || '根目录'}`);
    res.json({
        currentFolder: folderPath || '',
        parentFolder: parentFolder,
        breadcrumb: breadcrumb,
        folders: folders,
        files: files
    });
});

app.post('/api/rename-item', (req, res) => {
    const { username, password, itemPath, newName, isFolder } = req.body;
    if (!username || !password || !itemPath || !newName) {
        return res.json({ success: false, error: '缺少必要参数' });
    }
    if (!fs.existsSync(path.join(__dirname, 'userdata', username))) {
        return res.json({ success: false, error: '用户不存在' });
    }
    const userInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'userdata', username, 'info.json')));
    if (userInfo.password !== password) {
        return res.json({ success: false, error: '密码错误' });
    }
    const fullPath = path.join(__dirname, 'files', username, itemPath);
    if (!fs.existsSync(fullPath)) {
        return res.json({ success: false, error: '文件或文件夹不存在' });
    }
    const parentDir = path.dirname(fullPath);
    const newFullPath = path.join(parentDir, newName);
    if (fs.existsSync(newFullPath)) {
        return res.json({ success: false, error: '目标名称已存在' });
    }
    fs.renameSync(fullPath, newFullPath);
    log('INFO', `用户 ${username} 将 ${isFolder ? '文件夹' : '文件'} ${itemPath} 重命名为 ${newName}`);
    res.json({ success: true });
});

app.post('/api/move-item', (req, res) => {
    const { username, password, itemPath, targetFolder, isFolder } = req.body;
    if (!username || !password || !itemPath || targetFolder === undefined || targetFolder === null) {
        return res.json({ success: false, error: '缺少必要参数' });
    }
    if (!fs.existsSync(path.join(__dirname, 'userdata', username))) {
        return res.json({ success: false, error: '用户不存在' });
    }
    const userInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'userdata', username, 'info.json')));
    if (userInfo.password !== password) {
        return res.json({ success: false, error: '密码错误' });
    }
    const fullPath = path.join(__dirname, 'files', username, itemPath);
    if (!fs.existsSync(fullPath)) {
        return res.json({ success: false, error: '文件或文件夹不存在' });
    }
    const itemName = path.basename(fullPath);
    const targetDir = path.join(__dirname, 'files', username, targetFolder);
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
    const destPath = path.join(targetDir, itemName);
    if (fs.existsSync(destPath)) {
        return res.json({ success: false, error: '目标文件夹中已存在同名项目' });
    }
    if (isFolder === '1' || isFolder === true) {
        if (targetDir === fullPath || targetDir.startsWith(fullPath + path.sep)) {
            return res.json({ success: false, error: '不能移动到自身或子目录内' });
        }
    }
    fs.renameSync(fullPath, destPath);
    log('INFO', `用户 ${username} 将 ${isFolder ? '文件夹' : '文件'} ${itemPath} 移动到 ${targetFolder}`);
    res.json({ success: true });
});

app.post('/api/share', (req, res) => {
    const { username, password, itemPath, isFolder, extractCode } = req.body;
    if (!username || !password || !itemPath) {
        return res.json({ success: false, error: '缺少必要参数' });
    }
    if (!fs.existsSync(path.join(__dirname, 'userdata', username))) {
        return res.json({ success: false, error: '用户不存在' });
    }
    const userInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'userdata', username, 'info.json')));
    if (userInfo.password !== password) {
        return res.json({ success: false, error: '密码错误' });
    }
    const fullPath = path.join(__dirname, 'files', username, itemPath);
    if (!fs.existsSync(fullPath)) {
        return res.json({ success: false, error: '文件或文件夹不存在' });
    }
    const existing = findShareByItem(username, itemPath, isFolder);
    if (existing) {
        return res.json({ success: true, token: existing.token, shareUrl: `https://${getFormattedHost(req)}/share/${existing.token}`, existed: true });
    }
    let token = generateToken();
    let attempts = 0;
    while (fs.existsSync(getShareFilePath(token))) {
        token = generateToken();
        attempts++;
        if (attempts > 20) {
            return res.json({ success: false, error: '生成分享链接失败，请重试' });
        }
    }
    fs.writeFileSync(getShareFilePath(token), JSON.stringify({
        username,
        itemPath,
        isFolder: isFolder === '1' || isFolder === true,
        extractCode: extractCode || ''
    }));
    log('INFO', `用户 ${username} 创建分享 ${itemPath}，token=${token}`);
    res.json({ success: true, token: token, shareUrl: `https://${getFormattedHost(req)}/share/${token}`, existed: false });
});

app.post('/api/unshare', (req, res) => {
    const { username, password, itemPath, isFolder } = req.body;
    if (!username || !password || !itemPath) {
        return res.json({ success: false, error: '缺少必要参数' });
    }
    if (!fs.existsSync(path.join(__dirname, 'userdata', username))) {
        return res.json({ success: false, error: '用户不存在' });
    }
    const userInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'userdata', username, 'info.json')));
    if (userInfo.password !== password) {
        return res.json({ success: false, error: '密码错误' });
    }
    const existing = findShareByItem(username, itemPath, isFolder);
    if (!existing) {
        return res.json({ success: false, error: '分享链接不存在' });
    }
    fs.unlinkSync(getShareFilePath(existing.token));
    log('INFO', `用户 ${username} 删除分享 ${itemPath}，token=${existing.token}`);
    res.json({ success: true });
});

app.post('/api/copy-item', (req, res) => {
    const { username, password, itemPath, isFolder, newName } = req.body;
    if (!username || !password || !itemPath) {
        return res.json({ success: false, error: '缺少必要参数' });
    }
    if (!fs.existsSync(path.join(__dirname, 'userdata', username))) {
        return res.json({ success: false, error: '用户不存在' });
    }
    const userInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'userdata', username, 'info.json')));
    if (userInfo.password !== password) {
        return res.json({ success: false, error: '密码错误' });
    }
    const fullPath = path.join(__dirname, 'files', username, itemPath);
    if (!fs.existsSync(fullPath)) {
        return res.json({ success: false, error: '文件或文件夹不存在' });
    }
    const parentDir = path.dirname(fullPath);
    const baseName = path.basename(fullPath);
    let copyName = newName;
    if (!copyName) {
        const ext = path.extname(baseName);
        const nameWithoutExt = path.basename(baseName, ext);
        copyName = nameWithoutExt + ' - 副本' + ext;
    }
    const copyPath = path.join(parentDir, copyName);
    if (fs.existsSync(copyPath)) {
        return res.json({ success: false, error: '目标名称已存在' });
    }
    if (isFolder === '1' || isFolder === true) {
        fs.mkdirSync(copyPath);
        const items = fs.readdirSync(fullPath);
        items.forEach(item => {
            const src = path.join(fullPath, item);
            const dst = path.join(copyPath, item);
            if (fs.statSync(src).isDirectory()) {
                copyFolderRecursive(src, dst);
            } else {
                fs.copyFileSync(src, dst);
            }
        });
    } else {
        fs.copyFileSync(fullPath, copyPath);
    }
    log('INFO', `用户 ${username} 复制 ${isFolder ? '文件夹' : '文件'} ${itemPath} 为 ${copyName}`);
    res.json({ success: true });
});

app.post('/api/delete-item', (req, res) => {
    const { username, password, itemPath, isFolder } = req.body;
    if (!username || !password || !itemPath) {
        return res.json({ success: false, error: '缺少必要参数' });
    }
    if (!fs.existsSync(path.join(__dirname, 'userdata', username))) {
        return res.json({ success: false, error: '用户不存在' });
    }
    const userInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'userdata', username, 'info.json')));
    if (userInfo.password !== password) {
        return res.json({ success: false, error: '密码错误' });
    }
    const fullPath = path.join(__dirname, 'files', username, itemPath);
    if (!fs.existsSync(fullPath)) {
        return res.json({ success: false, error: '文件或文件夹不存在' });
    }
    if (isFolder === '1' || isFolder === true) {
        fs.rmSync(fullPath, { recursive: true });
        log('INFO', `用户 ${username} 删除文件夹 ${itemPath}`);
    } else {
        fs.unlinkSync(fullPath);
        log('INFO', `用户 ${username} 删除文件 ${itemPath}`);
    }
    res.json({ success: true });
});

app.get('/download/:path', (req, res) => {
    const decoded = decodeBase64(req.params.path).split('/');
    const username = decoded[0];
    const filePath = decoded.slice(1).join('/');
    
    if (!fs.existsSync(path.join(__dirname, 'userdata', username))) {
        res.sendFile(path.join(__dirname, 'public', 'user-not-found.html'));
        return;
    }
    if (!fs.existsSync(path.join(__dirname, 'files', username, filePath))) {
        res.sendFile(path.join(__dirname, 'public', 'file-not-found.html'));
        return;
    }
    res.download(path.join(__dirname, 'files', username, filePath));
});

app.get('/delete-file/:data', (req, res) => {
    const decoded = decodeBase64(req.params.data).split('/');
    const username = decoded[0];
    const password = decoded[1];
    const filename = decoded.slice(2).join('/');
    const fullPath = path.join(__dirname, 'files', username, filename);
    if (!fs.existsSync(path.join(__dirname, 'userdata', username))) {
        res.sendFile(path.join(__dirname, 'public', 'user-not-found.html'));
        return;
    }
    const userInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'userdata', username, 'info.json')));
    if (userInfo.password !== password) {
        res.sendFile(path.join(__dirname, 'public', 'pwd.html'));
        return;
    }
    if (!fs.existsSync(fullPath)) {
        res.sendFile(path.join(__dirname, 'public', 'file-not-found.html'));
        return;
    }
    fs.unlinkSync(fullPath);
    log('INFO', `删除文件: ${fullPath}`);
    res.send('<script>window.close();</script>');
})

app.get('/about', (req, res) => {
    res.render('about', { ip: req.ip });
});

function getFormattedHost(req) {
    return 's.apakp.top';
}

app.get('/q', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'q.html'));
});

app.get('/share/:token', (req, res) => {
    const token = req.params.token;
    const shareFile = getShareFilePath(token);
    if (!fs.existsSync(shareFile)) {
        res.sendFile(path.join(__dirname, 'public', 'file-not-found.html'));
        return;
    }
    const share = JSON.parse(fs.readFileSync(shareFile));
    const filePath = path.join(__dirname, 'files', share.username, share.itemPath);
    if (!fs.existsSync(filePath)) {
        res.sendFile(path.join(__dirname, 'public', 'file-not-found.html'));
        return;
    }
    const code = req.query.code || '';
    if (share.extractCode && code !== share.extractCode) {
        res.render('share', { share: share, token: token, needCode: true, error: req.query.error ? true : false, encodeBase64: encodeBase64 });
        return;
    }
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
        const files = scanDirForShare(filePath, share.itemPath);
        res.render('share', { share: share, token: token, isFolder: true, files: files, needCode: false, encodeBase64: encodeBase64 });
    } else {
        const fileName = path.basename(filePath);
        res.render('share', { share: share, token: token, isFolder: false, fileName: fileName, needCode: false, encodeBase64: encodeBase64 });
    }
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
    if (!fs.existsSync('shared')) {
        fs.mkdirSync('shared');
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

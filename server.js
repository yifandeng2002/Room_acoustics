const express = require('express');
const mqtt = require('mqtt');
const fs = require('fs').promises;  // 使用 promises API
const cors = require('cors');
const path = require('path');

const app = express();
const port = 3000;

// 启用 CORS
app.use(cors());
app.use(express.json());

// MQTT 配置
const broker = 'wss://joesdevices.cloud.shiftr.io:443';
const options = {
    clean: true,
    connectTimeout: 4000,
    clientId: 'serverClient-' + Math.floor(Math.random()*1000000),
    username: 'joesdevices',
    password: 'YOUR_TOKEN'  // 替换为你的 shiftr.io token
};

// 数据文件路径
const dataFilePath = path.join(__dirname, 'noise_data.json');

// 数据结构
let noiseData = {
    data: []
};

// 初始化数据文件
async function initDataFile() {
    try {
        // 尝试读取现有文件
        const data = await fs.readFile(dataFilePath, 'utf8');
        noiseData = JSON.parse(data);
        console.log('Loaded existing data file');
    } catch (error) {
        // 如果文件不存在，创建新文件
        await fs.writeFile(dataFilePath, JSON.stringify(noiseData, null, 2));
        console.log('Created new data file');
    }
}

// 保存数据到文件
async function saveData() {
    try {
        await fs.writeFile(dataFilePath, JSON.stringify(noiseData, null, 2));
        console.log('Data saved successfully');
    } catch (error) {
        console.error('Error saving data:', error);
    }
}

// 连接到 MQTT broker
const client = mqtt.connect(broker, options);

client.on('connect', () => {
    console.log('Connected to MQTT broker');
    client.subscribe('noise/level', (err) => {
        if (err) {
            console.error('Subscribe error:', err);
        } else {
            console.log('Subscribed to noise/level');
        }
    });
});

// 处理接收到的 MQTT 消息
client.on('message', async (topic, message) => {
    if (topic === 'noise/level') {
        const noiseLevel = parseFloat(message.toString());
        if (!isNaN(noiseLevel)) {
            const timestamp = new Date().toISOString();
            const newDataPoint = {
                timestamp: timestamp,
                value: noiseLevel
            };
            
            console.log('Received new data:', newDataPoint);
            
            // 添加新数据点
            noiseData.data.push(newDataPoint);
            
            // 移除超过24小时的数据
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            noiseData.data = noiseData.data.filter(item => 
                new Date(item.timestamp) > twentyFourHoursAgo
            );
            
            // 保存到文件
            await saveData();
        }
    }
});

client.on('error', (error) => {
    console.error('MQTT Error:', error);
});

// API 端点
app.get('/api/noise-data', async (req, res) => {
    try {
        // 直接返回内存中的数据
        res.json(noiseData);
    } catch (error) {
        console.error('Error serving data:', error);
        res.status(500).json({ error: 'Failed to retrieve data' });
    }
});

// 启动服务器
async function startServer() {
    try {
        await initDataFile();
        app.listen(port, () => {
            console.log(`Server running at http://localhost:${port}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
//MQTT
const broker = 'wss://joesdevices.cloud.shiftr.io:443';
const options = {
    clean: true,
    connectTimeout: 10000,
    clientId: 'joe_webClient-' + Math.floor(Math.random()*1000000),
    username: 'joesdevices',
    password: 'NAjOK6Eni6E9mcu3' //shiftr token
};

let noiseChart;
let mqttClient;
let noiseHistory = [];
let currentNoiseLevel = 0;
const MAX_HISTORY = 1000; 
const UPDATE_INTERVAL = 10000;

document.addEventListener('DOMContentLoaded', function() {
    console.log("Initializing...");
    setupCharts();
    initializeFilterButtons();
    initializeDeviceActions();
    initializeNotifications();
    updateDateTime();
    setInterval(updateDateTime, 60000);
    
    //initial update timestamps
    lastCurrentNoiseUpdate = Date.now();
    lastChartUpdate = Date.now();
    lastDailyAverageUpdate = Date.now();
    
    //initialize MQTT
    initializeMQTT();
    document.querySelector('.mqtt-status').style.display = 'none';
});


function updateDateTime() {
    const now = new Date();
    const greeting = document.querySelector('.top-bar h1');
    const hours = now.getHours();
    let timeOfDay = 'Morning';
    
    if (hours >= 12 && hours < 17) {
        timeOfDay = 'Afternoon';
    } else if (hours >= 17) {
        timeOfDay = 'Evening';
    }
    
    if (greeting) {
        greeting.textContent = `Good ${timeOfDay}, Joe`;
    }
}

function initializeMQTT() {
    updateConsoleStatus("Connecting to MQTT broker...");
    
    mqttClient = mqtt.connect(broker, options);
    mqttClient.on('connect', () => {
        console.log('Connected to MQTT broker');
        updateConsoleStatus("Connected to MQTT broker");
        // update MQTT status
        const statusIndicator = document.querySelector('.mqtt-status .status-indicator');
        const statusText = document.querySelector('.mqtt-status .status-text');
        if (statusIndicator) statusIndicator.classList.add('connected');
        if (statusText) statusText.textContent = "Connected to device";
        
        mqttClient.subscribe('noise/level', (err) => {
            if (err) {
                console.error('Subscription error:', err);
                updateConsoleStatus("Failed to subscribe: " + err.message);
            } else {
                updateConsoleStatus("Subscribed to noise data");
            }
        });
    });

    mqttClient.on('message', (topic, message) => {
        console.log('Received:', topic, message.toString());
        if (topic === 'noise/level') {
            handleNoiseLevel(parseFloat(message.toString()));
        }
    });

    mqttClient.on('error', (error) => {
        console.error('MQTT Error:', error);
        updateConsoleStatus("MQTT Error: " + error.message);
        
        // update MQTT status
        const statusIndicator = document.querySelector('.mqtt-status .status-indicator');
        const statusText = document.querySelector('.mqtt-status .status-text');
        if (statusIndicator) statusIndicator.classList.remove('connected');
        if (statusText) statusText.textContent = "Connection error";
    });

    mqttClient.on('close', () => {
        updateConsoleStatus("MQTT connection closed");
        
        // update MQTT status
        const statusIndicator = document.querySelector('.mqtt-status .status-indicator');
        const statusText = document.querySelector('.mqtt-status .status-text');
        if (statusIndicator) statusIndicator.classList.remove('connected');
        if (statusText) statusText.textContent = "Disconnected";
    });

    mqttClient.on('offline', () => {
        updateConsoleStatus("MQTT connection offline");
        
        // update MQTT status
        const statusIndicator = document.querySelector('.mqtt-status .status-indicator');
        const statusText = document.querySelector('.mqtt-status .status-text');
        if (statusIndicator) statusIndicator.classList.remove('connected');
        if (statusText) statusText.textContent = "Offline";
    });
}

let lastCurrentNoiseUpdate = 0;
let lastChartUpdate = 0;
let lastDailyAverageUpdate = 0;
const CURRENT_NOISE_UPDATE_INTERVAL = 10000; 
const CHART_UPDATE_INTERVAL = 10000;
const DAILY_AVERAGE_UPDATE_INTERVAL = 60000;

function handleNoiseLevel(value) {
    if (isNaN(value)) return;
    
    const previousLevel = currentNoiseLevel;
    currentNoiseLevel = value;
    // add timestamp
    const timestamp = new Date();
    noiseHistory.push({
        time: timestamp,
        value: value
    }); 

    if (noiseHistory.length > MAX_HISTORY) {
        noiseHistory.shift();
    }
    //update console
    updateConsoleStatus(`Noise Level: ${value.toFixed(1)} dB`);
    
    const now = Date.now();
    
    // update chart
    if (now - lastChartUpdate >= CHART_UPDATE_INTERVAL) {
        updateNoiseChart();
        lastChartUpdate = now;
    }
    
    // update Current Noise Level
    if (now - lastCurrentNoiseUpdate >= CURRENT_NOISE_UPDATE_INTERVAL) {
        updateCurrentNoiseLevel(value, previousLevel);
        lastCurrentNoiseUpdate = now;
    }
    
    // update Daily Average
    if (now - lastDailyAverageUpdate >= DAILY_AVERAGE_UPDATE_INTERVAL) {
        updateDailyAverage();
        lastDailyAverageUpdate = now;
    }
}

function updateCurrentNoiseLevel(value, previousLevel) {
    const noiseLevelElement = document.querySelector('.stat-card:first-child .stat-value');
    const noiseChangeElement = document.querySelector('.stat-card:first-child .stat-change');
    
    if (noiseLevelElement) {
        noiseLevelElement.textContent = `${value.toFixed(1)} dB`;
    }
    
    if (noiseChangeElement && previousLevel > 0) {
        const change = ((value - previousLevel) / previousLevel * 100).toFixed(1);
        noiseChangeElement.textContent = `${Math.abs(change)}%`;
        noiseChangeElement.classList.remove('increase', 'decrease');
        noiseChangeElement.classList.add(change >= 0 ? 'increase' : 'decrease');
    }
}

function addToHistory(value) {
    const timestamp = new Date();
    noiseHistory.push({
        time: timestamp,
        value: value
    });
    
    if (noiseHistory.length > MAX_HISTORY) {
        noiseHistory.shift();
    }
}

function updateDailyAverage() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    const todayReadings = noiseHistory.filter(reading => reading.time >= todayStart);
    
    if (todayReadings.length > 0) {
        const average = todayReadings.reduce((sum, reading) => sum + reading.value, 0) / todayReadings.length;
        
        const avgElement = document.querySelector('.stat-card:nth-child(2) .stat-value');
        const avgChangeElement = document.querySelector('.stat-card:nth-child(2) .stat-change');
        
        if (avgElement) {
            avgElement.textContent = `${average.toFixed(1)} dB`;
        }
    }
}


function updateConsoleStatus(message) {
    const consoleList = document.querySelector('.console-list');
    if (!consoleList) return;
    
    const timestamp = new Date().toLocaleTimeString();
    const entry = document.createElement('p');
    entry.className = 'console-entry latest';
    entry.textContent = `${timestamp} ${message}`;

    const previousLatest = consoleList.querySelector('.latest');
    if (previousLatest) {
        previousLatest.classList.remove('latest');
    }
    consoleList.insertBefore(entry, consoleList.firstChild);

    while (consoleList.children.length > 4) {
        consoleList.removeChild(consoleList.lastChild);
    }
}

function initializeFilterButtons() {
    const filterGroups = document.querySelectorAll('.time-filters');
    
    filterGroups.forEach(group => {
        const buttons = group.querySelectorAll('.filter-btn');
        
        buttons.forEach(button => {
            button.addEventListener('click', () => {
                buttons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                
                const timeFrame = button.textContent.trim();
                updateChartTimeFrame(timeFrame);
            });
        });
    });
}

function updateChartTimeFrame(timeFrame) {
    let duration;
    switch (timeFrame) {
        case '24 hrs':
            duration = 24 * 60 * 60 * 1000;
            break;
        case '1 week':
            duration = 7 * 24 * 60 * 60 * 1000;
            break;
        case '3 weeks':
            duration = 21 * 24 * 60 * 60 * 1000;
            break;
        case '1 month':
            duration = 30 * 24 * 60 * 60 * 1000;
            break;
        default:
            duration = 24 * 60 * 60 * 1000;
    }
    
    const cutoffTime = new Date(Date.now() - duration);
    noiseHistory = noiseHistory.filter(item => item.time >= cutoffTime);
    updateNoiseChart();
}

function initializeDeviceActions() {
    const deviceItems = document.querySelectorAll('.device-item');
    const addDeviceBtn = document.querySelector('.add-device-btn');
    
    deviceItems.forEach(item => {
        const actionBtn = item.querySelector('.device-action');
        actionBtn.addEventListener('click', () => {
            const deviceName = item.querySelector('.device-name').textContent;
            console.log(`Device action: ${deviceName}`);
        });
    });
    
    if (addDeviceBtn) {
        addDeviceBtn.addEventListener('click', () => {
            console.log('Add new device clicked');
        });
    }
}

function initializeNotifications() {
    const notificationBtn = document.querySelector('.notification-btn');
    if (notificationBtn) {
        notificationBtn.addEventListener('click', () => {
            console.log('Notifications clicked');
        });
    }
}


///////charts
function setupCharts() {
    const canvas = document.getElementById('noiseChart');
    const ctx = canvas.getContext('2d');
  
    //gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, 'rgb(92, 187, 255)');
    gradient.addColorStop(1, 'rgb(118, 118, 255)');

    const gradientfill = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradientfill.addColorStop(0, 'rgba(45, 146, 247, 0.4)');
    gradientfill.addColorStop(1, 'rgba(134, 118, 255, 0.4)');
  
    noiseChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: '',
          pointRadius: 0,         
          pointBackgroundColor: gradient, 
          pointHitRadius: 4, 
          data: [],
          borderColor: gradient,
          borderWidth: 2,
          backgroundColor: gradientfill,
          fill: true,
          tension: 0.5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: false
            },
            tooltip: {
                enabled: false
            }
        },
        scales: {
          x: {
            type: 'time', 
            time: {
              unit: 'minute',  
              displayFormats: {
                minute: 'h:mm a'         //'HH:mm' in 24hr format
              }
            },
            // 24hr
            //min: new Date(new Date().setHours(0, 0, 0, 0)),   // today 00:00
            //max: new Date(new Date().setHours(1, 0, 0, 0)),  // today 24:00
            
            //a dynamic 24 hrs from now
            min: Date.now() - 0.2 * 60 * 60 * 1000,
            max: Date.now(),
            grid: {
                display: true,
                color: 'rgba(131, 131, 131, 0.1)', 
                drawBorder: false, 
                tickColor: 'rgba(131, 131, 131, 0.2)'
            },
            ticks: {
                source: 'data',
                autoSkip: true,
                maxRotation: 0,
                maxTicksLimit: 5,
                color: 'rgba(131, 131, 131, 0.8)',
                font: {
                    family: "'HarmonyOS Sans-Medium', sans-serif",
                    size: 12
                },
                padding: 8 
            },
            border: {
                display: false
            }
          },
          y: {
            beginAtZero: false,
            title: {
              display: true,
              text: 'Noise (dB)'
            },
            grid: {
                display: true,
                color: 'rgba(131, 131, 131, 0.1)', 
                drawBorder: false, 
                tickColor: 'rgba(131, 131, 131, 0.2)' 
            },
            ticks: {
                source: 'data',
                autoSkip: true,
                maxRotation: 0,
                maxTicksLimit: 6,
                color: 'rgba(131, 131, 131, 0.8)',
                font: {
                    family: "'HarmonyOS Sans-Medium', sans-serif",
                    size: 12
                },
                padding: 8  
            },
            border: {
                display: false 
            }
          }
        }
      }
    });
  }

function updateNoiseChart() {
    if (!noiseChart) return;
    noiseChart.data.datasets[0].data = noiseHistory.map(item => ({
        x: item.time,
        y: item.value
    }));
    
    //update the time window
    const now = Date.now();
    noiseChart.options.scales.x.min = now - 0.2 * 60 * 60 * 1000;
    noiseChart.options.scales.x.max = now;
    noiseChart.update();
}


// simulate SensorData function
/*
function simulateSensorData() {
    console.log("Starting sensor data simulation...");
    handleNoiseLevel(Math.random() * 10 + 40); 
    setInterval(() => {
        handleNoiseLevel(Math.random() * 10 + 40);
    }, UPDATE_INTERVAL);
}
*/
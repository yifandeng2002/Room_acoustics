#include <WiFiNINA.h>
#include <ArduinoMqttClient.h>
#include <ArduinoJson.h>
#include "arduinoFFT.h"
#include "arduino_secrets.h"
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// OLED Display settings
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1  // Reset pin # (or -1 if sharing Arduino reset)
#define SCREEN_ADDRESS 0x3C  // Typically 0x3C for 128x64
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

const int AUDIO_IN_PIN = A0;    
const int MAX9814_GAIN_PIN = 4; 
const float VCC = 3.3;          
const int ADC_MAX_VALUE = 1024; 

const int SAMPLE_WINDOW = 50;

const int MA_SIZE = 5;
float noiseReadings[MA_SIZE];
int readingIndex = 0;

// wifi连接设置
const int CONNECTION_TIMEOUT = 10000; // 15秒

// 定义多个WiFi网络的凭据数组
struct WifiCredentials {
    const char* ssid;
    const char* password;
};

WifiCredentials wifiNetworks[NUM_WIFI_NETWORKS];

// 活跃网络索引（当前连接的网络）
int activeNetworkIndex = -1;

// mqtt
const char broker[] = "joesdevices.cloud.shiftr.io";
const int mqtt_port = 1883;
const char mqtt_username[] = "joesdevices";
const char mqtt_password[] = "NAjOK6Eni6E9mcu3";
const char clientId[] = "joes_sound_analyzer";
const char* NOISE_LEVEL_TOPIC = "noise/level";
const char* FREQ_RESPONSE_TOPIC = "audio/frequency_response";

// fft
const uint16_t samples = 128;
const double samplingFrequency = 20000; 
const unsigned int sampling_period_us = round(1000000 * (1.0 / samplingFrequency));
double vReal[samples];
double vImag[samples];
ArduinoFFT<double> FFT = ArduinoFFT<double>(vReal, vImag, samples, samplingFrequency);

// number of frequency bins
const int freqBins = samples / 2;

// Display update interval
const unsigned long displayUpdateInterval = 500; // 500ms
unsigned long lastDisplayUpdate = 0;

// clients
WiFiClient wifiClient;
MqttClient mqttClient(wifiClient);

unsigned long lastSendTime = 0;
const int sendInterval = 1000; // every 1 second

// WiFi监控间隔
const unsigned long wifiCheckInterval = 30000; // 30秒检查一次WiFi状态
unsigned long lastWifiCheck = 0;

// Variables to store status for display
bool wifiConnected = false;
bool mqttConnected = false;
float currentNoiseLevel = 0;
int deviceStatus = 0; // 0: initializing, 1: connected, 2: error

void setup() {
    Serial.begin(115200);
    
    // Initialize OLED display
    if(!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
        Serial.println(F("SSD1306 allocation failed"));
        for(;;); // Don't proceed, loop forever
    }
    
    // Initial display setup
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println(F("Initializing..."));
    display.display();
    
    while (!Serial && millis() < 5000);
    Serial.println("Initializing sensor...");  
    setupMAX9814();
    
    // 初始化WiFi凭据
    setupWifiCredentials();
    
    // 尝试连接到WiFi
    updateDisplayStatus("Scanning WiFi...");
    initializeWiFi();
    
    int retryCount = 0;
    const int maxRetries = 3;
    
    updateDisplayStatus("Connecting to MQTT...");
    while (retryCount < maxRetries) {
        if (initializeMQTT()) {
            break;
        }
        retryCount++;
        Serial.print("Retry attempt ");
        Serial.print(retryCount);
        Serial.println(" of 3");
        
        String retryMsg = "MQTT Retry " + String(retryCount) + "/3";
        updateDisplayStatus(retryMsg);
        
        delay(5000);
    }
    
    for (int i = 0; i < MA_SIZE; i++) {
        noiseReadings[i] = 0;
    }
    
    deviceStatus = 1; // Connected
    updateDisplayStatus("Setup complete!");
    delay(1000);
    
    // Draw the initial UI layout
    drawDisplayUI();
    
    Serial.println("Setup complete!");
}

void setupWifiCredentials() {
    // 从arduino_secrets.h文件中加载WiFi凭据
    wifiNetworks[0].ssid = SECRET_SSID1;
    wifiNetworks[0].password = SECRET_PASS1;
    
    wifiNetworks[1].ssid = SECRET_SSID2;
    wifiNetworks[1].password = SECRET_PASS2;
    
    wifiNetworks[2].ssid = SECRET_SSID3;
    wifiNetworks[2].password = SECRET_PASS3;
}

void setupMAX9814() {
    analogReadResolution(10);
    
    if (MAX9814_GAIN_PIN > 0) {
        pinMode(MAX9814_GAIN_PIN, OUTPUT);
        digitalWrite(MAX9814_GAIN_PIN, LOW);
    }
}

void loop() {
    // 定期检查WiFi连接状态
    if (millis() - lastWifiCheck >= wifiCheckInterval) {
        checkWifiConnection();
        lastWifiCheck = millis();
    }
    
    if (!mqttClient.connected()) {
        mqttConnected = false;
        Serial.println("MQTT disconnected, attempting to reconnect...");
        updateDisplayStatus("MQTT reconnecting...");
        if (!reconnectMQTT()) {
            Serial.println("Failed to reconnect to MQTT. Restarting...");
            updateDisplayStatus("Restarting...");
            delay(1000);
            NVIC_SystemReset();
        }
    }
    
    mqttClient.poll();
    
    // Update display periodically
    if (millis() - lastDisplayUpdate >= displayUpdateInterval) {
        updateDisplay();
        lastDisplayUpdate = millis();
    }
    
    if (millis() - lastSendTime >= sendInterval) {
        // Measure and send noise level
        currentNoiseLevel = measureNoiseLevel();
        sendNoiseData(currentNoiseLevel);

        // FFT analysis + send frequency data
        performFFTAnalysis();
        
        lastSendTime = millis();
    }
}

void checkWifiConnection() {
    if (WiFi.status() != WL_CONNECTED) {
        wifiConnected = false;
        Serial.println("WiFi connection lost! Attempting to reconnect...");
        updateDisplayStatus("WiFi lost! Reconnecting...");
        
        // 尝试重新连接到所有网络
        if (!tryConnectToAnyWifi()) {
            // 所有网络都连接失败，重启设备
            Serial.println("All WiFi connection attempts failed. Restarting...");
            updateDisplayStatus("WiFi failed. Restarting...");
            delay(2000);
            NVIC_SystemReset();
        }
    }
}

void updateDisplayStatus(String message) {
    display.clearDisplay();
    display.setCursor(0, 0);
    display.println(message);
    display.display();
}

void drawDisplayUI() {
    display.clearDisplay();
    
    // Status section
    display.setCursor(0, 0);
    display.print(F("WiFi: "));
    
    display.setCursor(0, 10);
    display.print(F("MQTT: "));
    
    // Data section
    display.setCursor(0, 20);
    display.print(F("dB Level: "));
    
    // Draw a mini VU meter border
    display.drawRect(0, 32, display.width(), 10, SSD1306_WHITE);
    
    display.display();
}

void updateDisplay() {
    // Update WiFi information with active network
    display.fillRect(40, 0, 88, 8, SSD1306_BLACK);
    display.setCursor(40, 0);
    if (wifiConnected && activeNetworkIndex >= 0) {
        display.print(wifiNetworks[activeNetworkIndex].ssid);
    } else {
        display.print(F("Disconnected"));
    }
    
    display.fillRect(40, 10, 88, 8, SSD1306_BLACK);
    display.setCursor(40, 10);
    display.print(mqttConnected ? F("Connected") : F("Disconnected"));
    
    // Update noise level
    display.fillRect(60, 20, 68, 8, SSD1306_BLACK);
    display.setCursor(60, 20);
    display.print(currentNoiseLevel, 1);
    display.print(F(" dB"));
    
    // Update VU meter
    int meterWidth = map(constrain(currentNoiseLevel, 30, 100), 30, 100, 1, display.width() - 2);
    display.fillRect(1, 33, display.width() - 2, 8, SSD1306_BLACK);
    display.fillRect(1, 33, meterWidth, 8, SSD1306_WHITE);
    
    display.display();
}

float measureNoiseLevel() {
    unsigned long startMillis = millis();
    unsigned int signalMax = 0;
    unsigned int signalMin = ADC_MAX_VALUE;
    
    while (millis() - startMillis < SAMPLE_WINDOW) {
        int sample = analogRead(AUDIO_IN_PIN);
        if (sample > signalMax) {
            signalMax = sample;
        } else if (sample < signalMin) {
            signalMin = sample;
        }
    }
    
    int peakToPeak = signalMax - signalMin;
    float db_spl = map(peakToPeak, 0, ADC_MAX_VALUE, 30, 120);
    
    noiseReadings[readingIndex] = db_spl;
    readingIndex = (readingIndex + 1) % MA_SIZE;
    
    float averageNoise = 0;
    for (int i = 0; i < MA_SIZE; i++) {
        averageNoise += noiseReadings[i];
    }
    return averageNoise / MA_SIZE;
}

bool sendNoiseData(float noiseLevel) {
    bool success = true;
    
    if (!mqttClient.beginMessage(NOISE_LEVEL_TOPIC)) {
        Serial.println("Failed to begin MQTT message");
        return false;
    }
    
    mqttClient.print(noiseLevel, 1);
    
    if (!mqttClient.endMessage()) {
        Serial.println("Failed to end MQTT message");
        return false;
    }
    
    Serial.print("Sound Level: ");
    Serial.println(noiseLevel);
    return true;
}

void performFFTAnalysis() {
    unsigned long microseconds;
    // sample audio input
    microseconds = micros();
    for (int i = 0; i < samples; i++) {
        vReal[i] = analogRead(AUDIO_IN_PIN);
        vImag[i] = 0;
        
        while (micros() - microseconds < sampling_period_us) {
        }
        microseconds += sampling_period_us;
    }
    
    // fft
    FFT.windowing(FFTWindow::Hamming, FFTDirection::Forward);
    FFT.compute(FFTDirection::Forward);
    FFT.complexToMagnitude();
    
    // send 20 sample points
    const int numPoints = 20;
    const float maxFreq = 20000.0;
    
    StaticJsonDocument<512> doc;
    
    JsonArray freqArray = doc.createNestedArray("frequencies");
    JsonArray magArray = doc.createNestedArray("magnitudes");
    
    for (int i = 0; i < numPoints; i++) {
        // skip 1st point
        int index = 2 + i * ((freqBins - 1) / numPoints);
        if (index >= freqBins) index = freqBins - 1;  
        float frequency = (index * samplingFrequency) / samples;
        float magnitude = vReal[index]; 
        
        freqArray.add(int(frequency));
        magArray.add(int(magnitude));
    }
    
    doc["timestamp"] = millis();
    
    // send freq data
    sendFrequencyDataMQTT(doc);
}

bool sendFrequencyDataMQTT(JsonDocument& doc) {
    if (!mqttClient.connected()) {
        Serial.println("MQTT disconnected, cannot send data");
        return false;
    }
    
    String jsonString;
    serializeJson(doc, jsonString);
    Serial.println("Sending JSON: " + jsonString);
    
    if (!mqttClient.beginMessage(FREQ_RESPONSE_TOPIC)) {
        Serial.println("Failed to begin MQTT message");
        return false;
    }
    
    mqttClient.print(jsonString);
    
    if (!mqttClient.endMessage()) {
        Serial.println("Failed to end MQTT message");
        return false;
    }
    
    Serial.println("Frequency data sent");
    return true;
}

bool tryConnectToWifi(int networkIndex) {
    if (networkIndex < 0 || networkIndex >= NUM_WIFI_NETWORKS) {
        return false;
    }
    
    String ssid = wifiNetworks[networkIndex].ssid;
    String password = wifiNetworks[networkIndex].password;
    
    Serial.print("Attempting to connect to WiFi network: ");
    Serial.println(ssid);
    
    String statusMsg = "Trying: " + ssid;
    updateDisplayStatus(statusMsg);
    
    WiFi.begin(ssid.c_str(), password.c_str());
    
    int dotCount = 0;
    unsigned long startTime = millis();
    
    while (WiFi.status() != WL_CONNECTED) {
        if (millis() - startTime > CONNECTION_TIMEOUT) {
            Serial.println("Connection timeout!");
            return false;
        }
        
        Serial.print(".");
        
        // Update display with dots to show progress
        display.fillRect(0, 25, display.width(), 10, SSD1306_BLACK);
        display.setCursor(0, 25);
        display.print("Connecting");
        for (int i = 0; i < dotCount; i++) {
            display.print(".");
        }
        display.display();
        
        dotCount = (dotCount + 1) % 4;
        delay(1000);
    }
    
    // 连接成功
    wifiConnected = true;
    activeNetworkIndex = networkIndex;
    
    Serial.println("\nWiFi connected!");
    Serial.print("SSID: ");
    Serial.println(ssid);
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
    
    // Show connection info on display
    display.fillRect(0, 25, display.width(), 20, SSD1306_BLACK);
    display.setCursor(0, 25);
    display.println("WiFi connected!");
    display.print("IP: ");
    display.println(WiFi.localIP());
    display.display();
    delay(1500);
    
    return true;
}

bool tryConnectToAnyWifi() {
    for (int i = 0; i < NUM_WIFI_NETWORKS; i++) {
        if (tryConnectToWifi(i)) {
            return true;
        }
        
        // 尝试下一个网络前简短延迟
        delay(1000);
    }
    
    return false;
}

void initializeWiFi() {
    if (!tryConnectToAnyWifi()) {
        // 所有WiFi连接都失败，准备重启
        Serial.println("All WiFi connection attempts failed! Restarting...");
        display.clearDisplay();
        display.setCursor(0, 0);
        display.println("WiFi failed!");
        display.println("Restarting...");
        display.display();
        delay(2000);
        
        // 重置设备
        NVIC_SystemReset();
    }
}

bool initializeMQTT() {
    Serial.println("Attempting MQTT connection...");
    Serial.print("Broker: ");
    Serial.println(broker);
    Serial.print("Port: ");
    Serial.println(mqtt_port);
    Serial.print("Username: ");
    Serial.println(mqtt_username);
    Serial.print("Client ID: ");
    Serial.println(clientId);
    
    // set mqtt connection
    mqttClient.setId(clientId);
    mqttClient.setUsernamePassword(mqtt_username, mqtt_password);
    
    // timeout
    Serial.println("Connecting to broker...");
    updateDisplayStatus("Connecting to MQTT...");
    
    if (!mqttClient.connect(broker, mqtt_port)) {
        Serial.print("MQTT connection failed! Error code = ");
        Serial.println(mqttClient.connectError());
        mqttConnected = false;
        return false;
    }
    
    mqttConnected = true;
    Serial.println("Connected to MQTT broker!");
    updateDisplayStatus("MQTT Connected!");
    return true;
}

bool reconnectMQTT() {
    if (WiFi.status() != WL_CONNECTED) {
        wifiConnected = false;
        Serial.println("WiFi not connected. Reconnecting to WiFi first...");
        updateDisplayStatus("WiFi reconnecting...");
        
        // 尝试重新连接到任意可用的WiFi
        if (!tryConnectToAnyWifi()) {
            return false;
        }
    }
    
    return initializeMQTT();
}
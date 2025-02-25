#include <WiFiNINA.h>
#include <ArduinoMqttClient.h>
#include "arduino_secrets.h"

// MAX9814 configuration
const int AUDIO_IN_PIN = A0;    
const int MAX9814_GAIN_PIN = 4; 
const float VCC = 3.3;          
const int ADC_MAX_VALUE = 1024; 

// Audio sampling configuration
const int SAMPLE_WINDOW = 50;    
const int BUFFER_SIZE = 128;     

// Moving average for noise level
const int MA_SIZE = 5;
float noiseReadings[MA_SIZE];
int readingIndex = 0;

// WiFi credentials
const char ssid[] = "Apt-25B";
const char pass[] = "newyorker";

// MQTT configuration
const char broker[] = "joesdevices.cloud.shiftr.io";
const int mqtt_port = 1883;
const char mqtt_username[] = "joesdevices";
const char mqtt_password[] = "NAjOK6Eni6E9mcu3";
const char clientId[] = "arduino_noise_monitor";

WiFiClient wifiClient;
MqttClient mqttClient(wifiClient);

// Topic for publishing
const char* NOISE_LEVEL_TOPIC = "noise/level";

// Timing variables
unsigned long lastSend = 0;
const int sendInterval = 1000;  

void setup() {
    Serial.begin(115200);
    while (!Serial && millis() < 5000);
    
    Serial.println("Initializing noise monitor...");
    
    setupMAX9814();
    initializeWiFi();
    
    // Try MQTT connection with retries
    int retryCount = 0;
    const int maxRetries = 3;
    
    while (retryCount < maxRetries) {
        if (initializeMQTT()) {
            break;
        }
        retryCount++;
        Serial.print("Retry attempt ");
        Serial.print(retryCount);
        Serial.println(" of 3");
        delay(5000);
    }
    
    if (retryCount >= maxRetries) {
        Serial.println("Failed to connect to MQTT after 3 attempts. Restarting...");
        delay(1000);
        NVIC_SystemReset();  // Reset the board
    }
    
    for (int i = 0; i < MA_SIZE; i++) {
        noiseReadings[i] = 0;
    }
    
    Serial.println("Setup complete!");
}

void setupMAX9814() {
    analogReadResolution(10);
    
    if (MAX9814_GAIN_PIN > 0) {
        pinMode(MAX9814_GAIN_PIN, OUTPUT);
        digitalWrite(MAX9814_GAIN_PIN, LOW);
    }
}

void loop() {
    if (!mqttClient.connected()) {
        Serial.println("MQTT disconnected, attempting to reconnect...");
        if (!reconnectMQTT()) {
            Serial.println("Failed to reconnect to MQTT. Restarting...");
            delay(1000);
            NVIC_SystemReset();
        }
    }
    
    mqttClient.poll();
    
    if (millis() - lastSend >= sendInterval) {
        float noiseLevel = measureNoiseLevel();
        if (!sendNoiseData(noiseLevel)) {
            Serial.println("Failed to send noise data!");
        }
        lastSend = millis();
    }
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
    
    Serial.print("Noise Level (dB SPL): ");
    Serial.println(noiseLevel);
    return true;
}

void initializeWiFi() {
    Serial.print("Connecting to WiFi");
    WiFi.begin(ssid, pass);
    
    while (WiFi.status() != WL_CONNECTED) {
        Serial.print(".");
        delay(1000);
    }
    
    Serial.println("\nWiFi connected!");
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
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
    
    // Set MQTT connection properties
    mqttClient.setId(clientId);
    mqttClient.setUsernamePassword(mqtt_username, mqtt_password);
    
    // Connect with timeout
    Serial.println("Connecting to broker...");
    if (!mqttClient.connect(broker, mqtt_port)) {
        Serial.print("MQTT connection failed! Error code = ");
        Serial.println(mqttClient.connectError());
        return false;
    }
    
    Serial.println("Connected to MQTT broker!");
    return true;
}

bool reconnectMQTT() {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("WiFi not connected. Reconnecting to WiFi first...");
        initializeWiFi();
    }
    
    return initializeMQTT();
}
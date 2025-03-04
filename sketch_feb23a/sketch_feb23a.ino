#include <WiFiNINA.h>
#include <ArduinoMqttClient.h>
#include <ArduinoJson.h>
#include "arduinoFFT.h"
#include "arduino_secrets.h"

const int AUDIO_IN_PIN = A0;    
const int MAX9814_GAIN_PIN = 4; 
const float VCC = 3.3;          
const int ADC_MAX_VALUE = 1024; 

const int SAMPLE_WINDOW = 50;

const int MA_SIZE = 5;
float noiseReadings[MA_SIZE];
int readingIndex = 0;

// wifi
const char ssid[] = SECRET_SSID;
const char pass[] = SECRET_PASS;

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

// clients
WiFiClient wifiClient;
MqttClient mqttClient(wifiClient);

unsigned long lastSendTime = 0;
const int sendInterval = 1000; // every 1 second

void setup() {
    Serial.begin(115200);
    while (!Serial && millis() < 5000);
    Serial.println("Initializing sensor...");  
    setupMAX9814();
    initializeWiFi();
    
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
    
    if (millis() - lastSendTime >= sendInterval) {
        // send noise level
        float noiseLevel = measureNoiseLevel();
        sendNoiseData(noiseLevel);

        // fft analysis + send frequency data
        performFFTAnalysis();
        
        lastSendTime = millis();
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
    
    // set mqtt connection
    mqttClient.setId(clientId);
    mqttClient.setUsernamePassword(mqtt_username, mqtt_password);
    
    // timeout
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
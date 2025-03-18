const DATA_STORE_INTERVAL = 10000; // 10 seconds
let lastDataStore = 0;
let storageEnabled = true; // Always enabled by default

// Initialize the data storage system
function initializeDataStorage() {
    console.log("Initializing local data storage...");
    updateConsoleStatus("Initializing local data storage...");
    
    // Set up the periodic storage interval
    setInterval(checkAndStoreData, 1000); // Check every second, but only store data every 10 seconds
    
    updateConsoleStatus("Data storage enabled");
}

// Check and store data if it's time (every 10 seconds)
function checkAndStoreData() {
    const now = Date.now();
    
    if (now - lastDataStore >= DATA_STORE_INTERVAL) {
        storeCurrentData();
        lastDataStore = now;
    }
}

// Store the current noise and frequency data
function storeCurrentData() {
    try {
        // Prepare noise data
        const noiseData = {
            timestamp: new Date().toISOString(),
            noiseLevel: currentNoiseLevel,
        };
        
        // Prepare frequency data
        const freqData = {
            timestamp: new Date().toISOString(),
            frequencies: frequencyData.frequencies,
            magnitudes: frequencyData.magnitudes
        };
        
        // Store both datasets
        storeDataToLocal('noise', noiseData);
        storeDataToLocal('frequency', freqData);
        
    } catch (error) {
        console.error('Error preparing data for storage:', error);
        updateConsoleStatus(`Error storing data: ${error.message}`);
    }
}

// Send data to local storage endpoint using fetch()
function storeDataToLocal(dataType, data) {
    const endpoint = `/store/${dataType}`;
    
    fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`Server responded with status ${response.status}`);
        }
        return response.json();
    })
    .then(result => {
        console.log(`${dataType} data stored successfully:`, result);
    })
    .catch(error => {
        console.error(`Error storing ${dataType} data:`, error);
        updateConsoleStatus(`Error storing ${dataType} data: ${error.message}`);
    });
}

// Export data as CSV file that the user can download
function exportDataAsCSV() {
    try {
        // Create download link to the CSV file
        const now = new Date();
        const dateStr = now.toISOString().slice(0,10);
        const link = document.createElement('a');
        link.setAttribute('href', `/data/csv/noise_${dateStr}.csv`);
        link.setAttribute('download', `noise_data_${dateStr}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        updateConsoleStatus("Data exported as CSV");
    } catch (error) {
        console.error("Error exporting data:", error);
        updateConsoleStatus(`Error exporting data: ${error.message}`);
    }
}

// Add this to the document ready event
document.addEventListener('DOMContentLoaded', function() {
    // Call this after other initializations
    initializeDataStorage();
});
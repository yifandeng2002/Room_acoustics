const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const app = express();
const port = 3000;

// Middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static('./')); 

// Create data directory if it doesn't exist
const DATA_DIR = path.join(__dirname, 'data');
const CSV_DIR = path.join(DATA_DIR, 'csv');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
    console.log('Created data directory');
}
if (!fs.existsSync(CSV_DIR)) {
    fs.mkdirSync(CSV_DIR);
    console.log('Created CSV directory');
}

// Get new york timezone datetime string
function getNYDateTime() {
    return new Date().toLocaleString('en-US', { 
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).replace(/(\d+)\/(\d+)\/(\d+),\s(\d+):(\d+):(\d+)/, '$3-$1-$2T$4:$5:$6');
}

// Get new york timezone date (YYYY-MM-DD)
function getNYDate() {
    return getNYDateTime().split('T')[0];
}

// Route to store noise data
app.post('/store/noise', (req, res) => {
    try {
        const data = req.body;
        if (!data) {
            return res.status(400).json({ error: 'Invalid data format' });
        }
        
        // Use ny timezone time instead of original timestamp
        const nyDateTime = getNYDateTime();
        const nyDate = getNYDate();
        
        // Create csv file with noise level
        const csvFilePath = path.join(CSV_DIR, `noise_${nyDate}.csv`);
        
        // Create or append to csv
        if (!fs.existsSync(csvFilePath)) {
            console.log(`Creating new noise CSV file for date: ${nyDate}`);
            fs.writeFileSync(csvFilePath, 'timestamp,noiseLevel\n');
        }
        
        // Append the new data point
        fs.appendFileSync(csvFilePath, `${nyDateTime},${data.noiseLevel}\n`);
        
        res.status(200).json({ success: true, message: 'Noise data stored' });
    } catch (error) {
        console.error('Error storing noise data:', error);
        res.status(500).json({ error: 'Failed to store data', details: error.message });
    }
});

// Route to store frequency data
app.post('/store/frequency', (req, res) => {
    try {
        const data = req.body;
        if (!data || !data.frequencies || !data.magnitudes) {
            return res.status(400).json({ error: 'Invalid data format' });
        }
        
        // Use ny timezone time instead of original timestamp
        const nyDateTime = getNYDateTime();
        const nyDate = getNYDate();
        
        // Create a csv file for frequency data
        const csvFilePath = path.join(CSV_DIR, `frequency_${nyDate}.csv`);
        
        // Create or append to csv
        if (!fs.existsSync(csvFilePath)) {
            console.log(`Creating new frequency CSV file for date: ${nyDate}`);
            // Create header row with frequency values
            let header = 'timestamp';
            data.frequencies.forEach(freq => {
                header += `,${freq}Hz`;
            });
            fs.writeFileSync(csvFilePath, header + '\n');
        }
        
        // Append the new data point
        let row = nyDateTime;
        data.magnitudes.forEach(magnitude => {
            row += `,${magnitude}`;
        });
        fs.appendFileSync(csvFilePath, row + '\n');
        
        res.status(200).json({ success: true, message: 'Frequency data stored' });
    } catch (error) {
        console.error('Error storing frequency data:', error);
        res.status(500).json({ error: 'Failed to store data', details: error.message });
    }
});

// Check for date change at midnight to create new files
function setupDailyFileCreation() {
    // Function to create empty files for a new day
    function createNewDayFiles() {
        const today = getNYDate();
        console.log(`Creating empty files for new day: ${today}`);
        
        // Create empty csv files with headers only
        fs.writeFileSync(path.join(CSV_DIR, `noise_${today}.csv`), 'timestamp,noiseLevel\n');
        
        console.log(`New day's files created for ${today}`);
    }
    
    // Calculate time until midnight in ny timezone
    function scheduleNextDayFiles() {
        // Get current ny time
        const nyDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
        
        // Set tomorrow midnight in ny time
        const tomorrow = new Date(nyDate);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 5, 0); // 00:00:05 to avoid exactly midnight
        
        // Calculate milliseconds until tomorrow midnight
        const timeUntilMidnight = tomorrow - nyDate;
        console.log(`Next day's files will be created in ${Math.round(timeUntilMidnight/1000/60)} minutes (NY time)`);
        
        setTimeout(() => {
            createNewDayFiles();
            scheduleNextDayFiles(); // Schedule for the next day
        }, timeUntilMidnight);
    }
    
    // Start the scheduling
    scheduleNextDayFiles();
}

// Start the server
app.listen(port, () => {
    console.log(`Noise monitoring server running at http://localhost:${port}`);
    console.log(`Data storage directory: ${DATA_DIR}`);
    console.log(`Current NY time: ${getNYDateTime()}`);
    setupDailyFileCreation();
});
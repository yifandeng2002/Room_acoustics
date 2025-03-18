let frequencyChart;
let frequencyData = {
    frequencies: [],
    magnitudes: []
};
// history array
let frequencyHistory = {
    timestamps: [],
    data: []
};

// 30 min
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

// setup frequency chart
function setupFrequencyChart() {
    const canvas = document.getElementById('frequencyChart');
    if (!canvas) {
        console.error('Frequency chart canvas not found');
        return;
    }
    
    const ctx = canvas.getContext('2d');
    
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, 'rgba(92, 187, 255, 0.9)');
    gradient.addColorStop(1, 'rgba(118, 118, 255, 0.9)');
    
    frequencyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Frequency Response',
                data: [],
                backgroundColor: gradient,
                borderWidth: 0,
                borderRadius: 4,
                barPercentage: 0.95,
                categoryPercentage: 0.95
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
                    callbacks: {
                        title: function(tooltipItems) {
                            return tooltipItems[0].label + ' Hz';
                        },
                        label: function(context) {
                            return 'Magnitude: ' + context.raw.toFixed(2);
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: 'Frequency (Hz)'
                    },
                    ticks: {
                        callback: function(value) {
                            return value + ' Hz';
                        },
                        maxRotation: 0,
                        color: 'rgba(131, 131, 131, 0.8)',
                        font: {
                            family: "'HarmonyOS Sans-Medium', sans-serif",
                            size: 12
                        }
                    },
                    grid: {
                        color: 'rgba(131, 131, 131, 0.1)',
                        drawBorder: false
                    },
                    border: {
                        display: false
                    }
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Magnitude'
                    },
                    ticks: {
                        color: 'rgba(131, 131, 131, 0.8)',
                        font: {
                            family: "'HarmonyOS Sans-Medium', sans-serif",
                            size: 12
                        }
                    },
                    grid: {
                        color: 'rgba(131, 131, 131, 0.1)',
                        drawBorder: false
                    },
                    border: {
                        display: false
                    }
                }
            }
        }
    });
}

// handle frequency data
function handleFrequencyData(data) {
    try {
        let cleanData = data.trim();
        let isValid = false;
        let validJSON = cleanData;
        
        try {
            JSON.parse(cleanData);
            isValid = true;
        } catch (e) {
            console.warn("Initial JSON parse failed, attempting to fix:", e);
            
            const openBrace = cleanData.indexOf('{');
            const lastCloseBrace = cleanData.lastIndexOf('}');
            
            if (openBrace >= 0 && lastCloseBrace > openBrace) {
                validJSON = cleanData.substring(openBrace, lastCloseBrace + 1);
                try {
                    JSON.parse(validJSON);
                    isValid = true;
                } catch (e2) {
                    console.error("Could not fix JSON:", e2);
                }
            }
        }
        
        if (!isValid) {
            updateConsoleStatus("Error: Invalid JSON format in frequency data");
            return;
        }
        
        // parse json
        const parsedData = JSON.parse(validJSON);
        
        if (!parsedData.frequencies || !parsedData.magnitudes || 
            !Array.isArray(parsedData.frequencies) || !Array.isArray(parsedData.magnitudes) ||
            parsedData.frequencies.length !== parsedData.magnitudes.length) {
            updateConsoleStatus("Error: Invalid frequency data structure");
            return;
        }
        
        //add to history
        frequencyHistory.timestamps.push(Date.now());
        frequencyHistory.data.push({
            frequencies: [...parsedData.frequencies],
            magnitudes: [...parsedData.magnitudes]
        });
        
        //remove data before 30 min
        const cutoffTime = Date.now() - THIRTY_MINUTES_MS;
        let cutoffIndex = frequencyHistory.timestamps.findIndex(timestamp => timestamp >= cutoffTime);
        
        if (cutoffIndex > 0) {
            frequencyHistory.timestamps = frequencyHistory.timestamps.slice(cutoffIndex);
            frequencyHistory.data = frequencyHistory.data.slice(cutoffIndex);
        }
        
        calculateAndUpdateAverages();
        updateConsoleStatus(`Received frequency data: ${parsedData.frequencies.length} bins`);
        
    } catch (error) {
        console.error('Error processing frequency data:', error);
        updateConsoleStatus(`Error processing frequency data: ${error.message}`);
    }
}

function calculateAndUpdateAverages() {

    if (frequencyHistory.data.length === 0) return;
    const refFrequencies = frequencyHistory.data[0].frequencies;
    
    let frequencySums = {};
    let frequencyCounts = {};
    
    refFrequencies.forEach(freq => {
        frequencySums[freq] = 0;
        frequencyCounts[freq] = 0;
    });
    
    // add on all points
    frequencyHistory.data.forEach(dataPoint => {
        dataPoint.frequencies.forEach((freq, index) => {
            // find closest point
            const closestFreq = findClosestFrequency(freq, refFrequencies);
            frequencySums[closestFreq] += dataPoint.magnitudes[index];
            frequencyCounts[closestFreq]++;
        });
    });
    
    //calculte avr
    let averageFrequencies = [];
    let averageMagnitudes = [];
    
    Object.keys(frequencySums).forEach(freq => {
        if (frequencyCounts[freq] > 0) {
            averageFrequencies.push(parseFloat(freq));
            averageMagnitudes.push(frequencySums[freq] / frequencyCounts[freq]);
        }
    });
    
    // sort
    const sortedIndices = averageFrequencies.map((_, i) => i)
        .sort((a, b) => averageFrequencies[a] - averageFrequencies[b]);
    
    averageFrequencies = sortedIndices.map(i => averageFrequencies[i]);
    averageMagnitudes = sortedIndices.map(i => averageMagnitudes[i]);
    frequencyData = {
        frequencies: averageFrequencies,
        magnitudes: averageMagnitudes
    };
    
    updateFrequencyChart();
    analyzeFrequencyData(frequencyData);
}

function findClosestFrequency(value, array) {
    return array.reduce((prev, curr) => 
        Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev
    );
}



function updateFrequencyChart() {
    if (!frequencyChart) return;
    
    // get chosen freq range
    const activeFilterButton = document.querySelector('.frequency-filters .filter-btn.active');
    let filterRange = activeFilterButton ? activeFilterButton.textContent : 'All';
    
    let filteredFrequencies = [];
    let filteredMagnitudes = [];
    
    if (filterRange === 'All') {
        filteredFrequencies = frequencyData.frequencies;
        filteredMagnitudes = frequencyData.magnitudes;
    } else {
        const range = filterRange.split(' ')[0];
        const [minFreq, maxFreq] = range.split('-').map(v => parseFloat(v));
        
        // filter freq
        for (let i = 0; i < frequencyData.frequencies.length; i++) {
            const freq = frequencyData.frequencies[i];
            if (freq >= minFreq && (maxFreq ? freq <= maxFreq : true)) {
                filteredFrequencies.push(freq);
                filteredMagnitudes.push(frequencyData.magnitudes[i]);
            }
        }
    }
    
    // used for scaling
    const maxMagnitude = Math.max(...filteredMagnitudes, 1); 
    const chartData = filteredFrequencies.map((freq, index) => {
        const normalizedMag = filteredMagnitudes[index] / maxMagnitude * 100;
        return {
            x: freq,
            y: normalizedMag
        };
    });
    
    // update data
    frequencyChart.data.datasets[0].data = chartData;
    
    // add labels
    const historySizeMinutes = Math.min(30, Math.ceil(frequencyHistory.timestamps.length / 60));
    frequencyChart.data.datasets[0].label = `${historySizeMinutes}min average`;

    frequencyChart.options.scales.y.min = 0;
    frequencyChart.options.scales.y.max = 100;
    
    //update chart
    frequencyChart.update();
}

//determine the best use case
function analyzeFrequencyData(data) {
    // find dominant frequency bands
    const frequencyBands = [
        { name: "Low", min: 20, max: 200, total: 0, count: 0 },
        { name: "Mid", min: 200, max: 800, total: 0, count: 0 },
        { name: "High", min: 800, max: 20000, total: 0, count: 0 }
    ];
    
    // calculate average magnitude for each band
    for (let i = 0; i < data.frequencies.length; i++) {
        const freq = data.frequencies[i];
        const mag = data.magnitudes[i];
        
        for (let band of frequencyBands) {
            if (freq >= band.min && freq <= band.max) {
                band.total += mag;
                band.count++;
                break;
            }
        }
    }
    
    // calculate averages
    frequencyBands.forEach(band => {
        band.average = band.count > 0 ? band.total / band.count : 0;
    });
    
    // find the band with highest average magnitude
    let dominantBand = frequencyBands.reduce((prev, current) => 
        (current.average > prev.average) ? current : prev, frequencyBands[0]);
    
    // update best use case based on dominant frequencies
    const bestForValueElement = document.querySelector('.stat-card:nth-child(3) .stat-value');
    const bestForDetailElement = document.querySelector('.stat-card:nth-child(3) .stat-detail');
    
    if (bestForValueElement && bestForDetailElement) {
        let bestFor;
        
        if (dominantBand.name === "Low") {
            bestFor = "Relaxation";
        } else if (dominantBand.name === "Mid") {
            bestFor = "Focus";
        } else {
            bestFor = "Alertness";
        }
        
        bestForValueElement.textContent = bestFor;
        bestForDetailElement.textContent = `${dominantBand.min}-${dominantBand.max} Hz`;
    }
}

//frequency filter buttons
function initializeFrequencyFilters() {
    const filterButtons = document.querySelectorAll('.frequency-filters .filter-btn');
    
    filterButtons.forEach(button => {
        button.addEventListener('click', () => {
            filterButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            updateFrequencyChart();
        });
    });
}

// calculate a simple db value from frequency magnitudes
function calculateNoiseLevel(magnitudes) {
    if (!magnitudes || magnitudes.length === 0) return 0;
    
    // calculate RMS of magnitudes
    const sumSquares = magnitudes.reduce((sum, mag) => sum + mag * mag, 0);
    const rms = Math.sqrt(sumSquares / magnitudes.length);
    
    // convert to db
    // reference level: to be adjusted based on calibration
    const refLevel = 1.0;
    const dB = 20 * Math.log10(rms / refLevel);
    
    return Math.max(0, dB);
}

document.addEventListener('DOMContentLoaded', function() {
    setupFrequencyChart();
    initializeFrequencyFilters();
});

document.addEventListener('DOMContentLoaded', function() {
    const originalSetupCharts = setupCharts;
    window.setupCharts = function() {
        originalSetupCharts();
        
        if (frequencyChart) {
            frequencyChart.data.datasets[0].label = '30 min average';
            frequencyChart.options.plugins.legend.display = true;
            frequencyChart.update();
        }
    };
})
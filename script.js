// Updated script.js
document.addEventListener('DOMContentLoaded', function() {
    
    // Initialize knob controls
    initializeKnobs();
    
    // Initialize individual mic controls
    initializeMicControls();
});

function initializeKnobs() {
    const knobs = document.querySelectorAll('.knob');
    
    knobs.forEach(knob => {
        let isDragging = false;
        let startAngle = 0;
        let currentRotation = 0;
        
        knob.addEventListener('mousedown', startDragging);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', stopDragging);
        
        function startDragging(e) {
            isDragging = true;
            const knobRect = knob.getBoundingClientRect();
            const knobCenter = {
                x: knobRect.left + knobRect.width / 2,
                y: knobRect.top + knobRect.height / 2
            };
            startAngle = Math.atan2(e.clientY - knobCenter.y, e.clientX - knobCenter.x);
        }
        
        function drag(e) {
            if (!isDragging) return;
            
            const knobRect = knob.getBoundingClientRect();
            const knobCenter = {
                x: knobRect.left + knobRect.width / 2,
                y: knobRect.top + knobRect.height / 2
            };
            
            const currentAngle = Math.atan2(e.clientY - knobCenter.y, e.clientX - knobCenter.x);
            let rotation = currentRotation + (currentAngle - startAngle) * (180 / Math.PI);
            
            // Limit rotation to 270 degrees
            rotation = Math.max(-135, Math.min(135, rotation));
            
            const handle = knob.querySelector('.knob-handle');
            handle.style.transform = `translateX(-50%) rotate(${rotation}deg)`;
            
            // Update gain value
            const gainValue = Math.round((rotation + 135) / 270 * 60 - 30); // -30 to +30 dB
            const gainDisplay = knob.parentElement.querySelector('.gain-value');
            gainDisplay.textContent = `${gainValue} dB`;
        }
        
        function stopDragging() {
            if (!isDragging) return;
            isDragging = false;
            currentRotation = parseFloat(knob.querySelector('.knob-handle').style.transform.match(/-?\d+/)[0]);
        }
    });
}

function initializeMicControls() {
    const micButtons = document.querySelectorAll('.mic-connect-btn');
    
    micButtons.forEach((button, index) => {
        button.addEventListener('click', function() {
            const micControl = this.closest('.mic-control-item');
            const statusDot = micControl.querySelector('.mic-status');
            const statusText = micControl.querySelector('.connection-status');
            const isConnected = statusDot.classList.contains('connected');
            
            if (isConnected) {
                statusDot.classList.remove('connected');
                statusDot.classList.add('disconnected');
                statusText.textContent = 'Disconnected';
                this.textContent = 'Connect';
                this.classList.remove('connected');
            } else {
                statusDot.classList.remove('disconnected');
                statusDot.classList.add('connected');
                statusText.textContent = 'Connected';
                this.textContent = 'Disconnect';
                this.classList.add('connected');
            }
            
            // Update corresponding inspector mic status
            const inspectorMic = document.querySelectorAll('.inspector .mic')[index];
            const inspectorStatus = inspectorMic.querySelector('.mic-status');
            inspectorStatus.className = `mic-status ${isConnected ? 'disconnected' : 'connected'}`;
        });
    });
}
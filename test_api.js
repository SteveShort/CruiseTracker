const http = require('http');

http.get('http://localhost:5050/api/all-dashboard-data', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        const json = JSON.parse(data);
        const treasure = json.cruises.find(c => c.shipName === 'Disney Treasure');
        console.log(JSON.stringify(treasure, null, 2));
    });
});

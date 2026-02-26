const http = require('http');

http.get('http://localhost:5050/api/cruises', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            const treasure = json.find(c => c.shipName === 'Disney Treasure');
            console.log(JSON.stringify(treasure, null, 2));
        } catch(e) { console.log(e); }
    });
});

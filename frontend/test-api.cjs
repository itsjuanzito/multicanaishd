const http = require('http');

http.get('http://localhost:4321/api/preview-genre?id=28', (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log('Status Code:', res.statusCode);
    console.log('Headers:', res.headers);
    console.log('Body snippet:', data.substring(0, 300));
  });
}).on('error', (err) => console.log('Error:', err.message));

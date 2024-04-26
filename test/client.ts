import axios from 'axios';

async function main() {
  const { data } = await axios.get('http://127.0.0.1:1234/test');
  console.log(data);
}

main().then(() => process.exit(0));

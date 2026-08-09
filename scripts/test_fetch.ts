import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env.example');
const text = fs.readFileSync(envPath, 'utf8');
const match = text.match(/SUPABASE_URL=(.+)/);
const url = match ? match[1].trim() : '';

async function main(){
  if(!url){
    console.error('No URL found');
    process.exit(1);
  }
  try{
    const res = await fetch(url);
    console.log('status', res.status);
    const txt = await res.text();
    console.log('body', txt.slice(0,200));
  }catch(e){
    console.error('fetch error', String(e));
    process.exit(1);
  }
}

main();

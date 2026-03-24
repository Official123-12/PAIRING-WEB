# Session Id Generator For WhatsApp Bots Using Paste Bin

**It Will Uploads Your Creds To Pastebin And Will Sends You Id Of That File.**


**How Session Id Will Works?**
<details>
  <summary>Click Here To View?</summary>
  <p>

  ```js
import { fileURLToPath } from 'url';
import path from 'path';
import { writeFileSync } from 'fs';
import axios from 'axios'; // use axios to fetch raw Pastebin data

async function SaveCreds(txt) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const PasteId = txt.replace('Some-Custom-Words_', '');

  // The 'txt' parameter should contain the Pastebin Id
  const pastebinUrl = `https://pastebin.com/raw/${PasteId}`;  // Construct raw Pastebin URL
  console.log(`PASTE URL: ${pastebinUrl}`);

  try {
    // Fetch the raw data from Pastebin
    const response = await axios.get(pastebinUrl);

    // Ensure the data is a string or Buffer
    const data = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

    // Define the path to save the creds.json file in the session folder
    const credsPath = path.join(__dirname, '..', 'session', 'creds.json');
    
    // Write the fetched data to creds.json
    writeFileSync(credsPath, data);
    console.log('Saved credentials to', credsPath);
    
  } catch (error) {
    console.error('Error downloading or saving credentials:', error);
  }
}

export default SaveCreds;

// Exports the `SaveCreds` function as the default export of this module, making it available for use in main file.


//Now Import Function In Main File
dotenv.config()
import SaveCreds from './some-file.js'

async function main() {
  const txt = process.env.SESSION_ID

  if (!txt) {
    console.error('Environment variable not found.')
    return
  }

  try {
    await SaveCreds(txt)
    console.log('process SaveCreds completed.')
  } catch (error) {
    console.error('Error:', error)
  }
}

main()
// Now Use Further code 
```
</p>
</details>



BOTH PAIR CODE AND QR CODE WORKING

YOU CAN DEPLOY IT ON ANY CLOUD PLATFORM e.g `HEROKU` `RENDER` `KOYEB` etc.

⭐ THE REPO IF YOU ARE GOING TO COPY OR FORK

Note: Make Sure Put PASTEBIN_API_KEY in environment variables ( Required In Paste.js ) Before Running/Deploying The API.

## OTHER PROJECTS:

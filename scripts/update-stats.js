const admin = require("firebase-admin");
const axios = require("axios");

console.log("--- STARTING UNIVERSAL LOADER ---");

const secret = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!secret) {
    console.error("❌ FATAL: The 'FIREBASE_SERVICE_ACCOUNT' secret is empty in GitHub Settings.");
    process.exit(1);
}

console.log(`Input length: ${secret.length} characters.`);

let serviceAccount;

// ATTEMPT 1: Try reading it as a 'Magic String' (Base64)
try {
    const decoded = Buffer.from(secret, 'base64').toString('ascii');
    // If decoding creates a valid JSON string, parse it
    if (decoded.trim().startsWith('{')) {
        serviceAccount = JSON.parse(decoded);
        console.log("✅ SUCCESS: Detected and loaded 'Magic String' (Base64) key.");
    } else {
        throw new Error("Not Base64");
    }
} catch (e1) {
    // ATTEMPT 2: Try reading it as normal JSON (Raw text)
    try {
        serviceAccount = JSON.parse(secret);
        console.log("✅ SUCCESS: Detected and loaded Raw JSON key.");
    } catch (e2) {
        console.error("❌ ERROR: Could not read the key in ANY format.");
        
        // Diagnosis helper
        const trimmed = secret.trim();
        if (trimmed.startsWith('{')) {
             if (!trimmed.endsWith('}')) {
                 console.error("👉 DIAGNOSIS: It looks like Raw JSON, but the end is missing.");
                 console.error("👉 You likely missed the final '}' curly brace when copying.");
             } else {
                 console.error("👉 DIAGNOSIS: The JSON syntax is broken. Check for extra quotes or missing commas.");
             }
        } else {
            console.error("👉 DIAGNOSIS: The key doesn't look like JSON. Did you paste the right file?");
        }
        
        process.exit(1);
    }
}

// Initialize Firebase with the result from above
try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("✅ Firebase Connection Established.");
} catch (e) {
    console.error("❌ FIREBASE ERROR:", e.message);
    process.exit(1);
}

const db = admin.firestore();
const METS_ID = 121;
const YEAR = 2026; 

async function updateSchedule() {
  console.log("Fetching Schedule...");
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${METS_ID}&season=${YEAR}&hydrate=team,linescore`;
  
  try {
    const res = await axios.get(url);
    const dates = res.data.dates || [];
    
    if (dates.length === 0) {
        console.log("No games found (Offseason?).");
        return;
    }

    const batch = db.batch();
    
    dates.forEach(d => {
      const game = d.games[0];
      const isHome = game.teams.home.team.id === METS_ID;
      const opponent = isHome ? game.teams.away.team.name : game.teams.home.team.name;
      
      let result = 'Pending';
      let scoreUs = 0;
      let scoreThem = 0;
      
      if (game.status.abstractGameState === 'Final') {
        scoreUs = isHome ? game.teams.home.score : game.teams.away.score;
        scoreThem = isHome ? game.teams.away.score : game.teams.home.score;
        result = scoreUs > scoreThem ? 'W' : 'L';
      }

      const docRef = db.collection('mets_schedule_2026').doc(String(game.gamePk));
      
      batch.set(docRef, {
        date: d.date,
        opponent: opponent,
        location: isHome ? 'Home' : 'Away',
        time: new Date(game.gameDate).toLocaleTimeString('en-US', { hour: '2-digit', minute:'2-digit', timeZone: 'America/New_York' }),
        gameType: game.gameType === 'S' ? 'Spring' : 'Regular',
        result: result,
        scoreUs: scoreUs,
        scoreThem: scoreThem,
        season: String(YEAR)
      }, { merge: true }); 
    });

    await batch.commit();
    console.log(`Updated ${dates.length} games.`);
  } catch (error) {
    console.error("Error updating schedule:", error);
    process.exit(1);
  }
}

async function updateRoster() {
  console.log("Fetching Roster...");
  const url = `https://statsapi.mlb.com/api/v1/teams/${METS_ID}/roster`;
  
  try {
    const res = await axios.get(url);
    const roster = res.data.roster || [];
    
    const batch = db.batch();

    roster.forEach(p => {
      const docRef = db.collection('mets_squad').doc(String(p.person.id));
      
      batch.set(docRef, {
        name: p.person.fullName,
        number: p.jerseyNumber,
        position: p.position.name,
        mlbId: p.person.id,
        status: 'Active (30-Man)',
      }, { merge: true });
    });

    await batch.commit();
    console.log(`Updated ${roster.length} players.`);
  } catch (error) {
    console.error("Error updating roster:", error);
  }
}

async function run() {
  await updateSchedule();
  await updateRoster();
  process.exit(0);
}

run();

const admin = require("firebase-admin");
const axios = require("axios");

// Initialize Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const METS_ID = 121;
const YEAR = 2026; 

async function updateSchedule() {
  console.log("Fetching Schedule...");
  // MLB API for Schedule
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${METS_ID}&season=${YEAR}&hydrate=team,linescore`;
  
  try {
    const res = await axios.get(url);
    const dates = res.data.dates || [];
    
    if (dates.length === 0) {
        console.log("No games found.");
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

      // We use the Game PK as the ID so we don't create duplicates
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
    process.exit(1); // Force error so we know if it fails
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
    // Don't exit here, we want to finish even if roster fails
  }
}

async function run() {
  await updateSchedule();
  await updateRoster();
  process.exit(0);
}

run();

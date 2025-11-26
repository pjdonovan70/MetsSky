const admin = require("firebase-admin");
const axios = require("axios");

console.log("--- STARTING UNIVERSAL LOADER + BLUESKY ---");

// --- DECODE KEY ---
const secret = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!secret) { console.error("❌ FATAL: Secret is empty."); process.exit(1); }

let serviceAccount;
try {
    const decoded = Buffer.from(secret, 'base64').toString('ascii');
    if (decoded.trim().startsWith('{')) {
        serviceAccount = JSON.parse(decoded);
    } else {
        throw new Error("Not Base64");
    }
} catch (e) {
    try {
        serviceAccount = JSON.parse(secret);
    } catch (e2) {
        console.error("❌ ERROR: Could not read key.");
        process.exit(1);
    }
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const METS_ID = 121;
const YEAR = 2026; 

// --- 1. BLUESKY FUNCTION ---
async function updateBluesky() {
    console.log("Fetching #MetsSky from Bluesky...");
    // Search for the hashtag, limit to 25 latest posts
    const url = "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=%23MetsSky&limit=25&sort=latest";

    try {
        const res = await axios.get(url);
        const posts = res.data.posts || [];
        const batch = db.batch();

        posts.forEach(post => {
            // Create a unique ID from the Bluesky URI
            const id = post.uri.split('/').pop();
            const docRef = db.collection('mets_social').doc(id);

            // Extract image if it exists
            let imageUrl = null;
            if (post.embed && post.embed.images && post.embed.images.length > 0) {
                imageUrl = post.embed.images[0].fullsize;
            }

            // Construct the public link
            const handle = post.author.handle;
            const postLink = `https://bsky.app/profile/${handle}/post/${id}`;

            batch.set(docRef, {
                authorName: post.author.displayName || handle,
                authorHandle: handle,
                avatar: post.author.avatar || null,
                text: post.record.text,
                postedAt: post.record.createdAt,
                imageUrl: imageUrl,
                url: postLink,
                type: 'Bluesky'
            }, { merge: true });
        });

        await batch.commit();
        console.log(`✅ Updated ${posts.length} Bluesky posts.`);
    } catch (error) {
        console.error("❌ Error fetching Bluesky:", error.message);
    }
}

// --- 2. SCHEDULE FUNCTION ---
async function updateSchedule() {
  console.log("Fetching Schedule...");
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${METS_ID}&season=${YEAR}&hydrate=team,linescore`;
  
  try {
    const res = await axios.get(url);
    const dates = res.data.dates || [];
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
    console.log(`✅ Updated ${dates.length} games.`);
  } catch (error) {
    console.error("❌ Error updating schedule:", error.message);
  }
}

// --- 3. ROSTER FUNCTION ---
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
    console.log(`✅ Updated ${roster.length} players.`);
  } catch (error) {
    console.error("❌ Error updating roster:", error.message);
  }
}

async function run() {
  await updateSchedule();
  await updateRoster();
  await updateBluesky(); // <--- Running the new function
  process.exit(0);
}

run();

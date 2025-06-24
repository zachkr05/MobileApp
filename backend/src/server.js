import express from "express";
import { ENV } from "./config/env.js";
import axios from "axios";
import querystring from "querystring";
import { db } from "./config/db.js";
import { users } from "./db/schema.js";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

const app = express();
const PORT = ENV.PORT || 8001;

// Add JSON body parser middleware
app.use(express.json());

// Client id test
console.log("Client ID:", ENV.SPOTIFY_CLIENT_ID);

app.get("/api/health", (req, res) => {
  res.status(200).json({ success: true });
});

// Spotify API endpoints
app.get("/api/spotify/top-tracks", async (req, res) => {
  const { access_token, time_range = "medium_term", limit = 20 } = req.query;
  
  if (!access_token) {
    return res.status(401).json({ error: "No access token provided" });
  }
  
  try {
    const response = await axios.get("https://api.spotify.com/v1/me/top/tracks", {
      headers: { Authorization: `Bearer ${access_token}` },
      params: { time_range, limit }
    });
    
    res.json(response.data);
  } catch (error) {
    console.error("Error fetching top tracks:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ 
      error: "Failed to fetch top tracks", 
      details: error.response?.data 
    });
  }
});

app.get("/api/spotify/recently-played", async (req, res) => {
  const { access_token, limit = 20 } = req.query;
  
  if (!access_token) {
    return res.status(401).json({ error: "No access token provided" });
  }
  
  try {
    const response = await axios.get("https://api.spotify.com/v1/me/player/recently-played", {
      headers: { Authorization: `Bearer ${access_token}` },
      params: { limit }
    });
    
    res.json(response.data);
  } catch (error) {
    console.error("Error fetching recently played:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ 
      error: "Failed to fetch recently played tracks", 
      details: error.response?.data 
    });
  }
});

app.get("/api/spotify/me", async (req, res) => {
  const { access_token } = req.query;
  
  if (!access_token) {
    return res.status(401).json({ error: "No access token provided" });
  }
  
  try {
    const response = await axios.get("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    
    res.json(response.data);
  } catch (error) {
    console.error("Error fetching profile:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ 
      error: "Failed to fetch profile", 
      details: error.response?.data 
    });
  }
});

// Token refresh endpoint
app.post("/api/spotify/refresh-token", async (req, res) => {
  const { refresh_token } = req.body;
  
  if (!refresh_token) {
    return res.status(400).json({ error: "No refresh token provided" });
  }
  
  try {
    const response = await axios.post(
      "https://accounts.spotify.com/api/token",
      querystring.stringify({
        grant_type: "refresh_token",
        refresh_token: refresh_token
      }),
      {
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${ENV.SPOTIFY_CLIENT_ID}:${ENV.SPOTIFY_CLIENT_SECRET}`
          ).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );
    
    res.json(response.data);
  } catch (error) {
    console.error("Error refreshing token:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ 
      error: "Failed to refresh token", 
      details: error.response?.data 
    });
  }
});

// Store user data
app.post("/api/spotify/store-user", async (req, res) => {
  const { profile, access_token, refresh_token } = req.body;
  
  if (!profile || !profile.id) {
    return res.status(400).json({ error: "Invalid profile data" });
  }
  
  try {
    // Check if user exists
    const existingUsers = await db
      .select()
      .from(users)
      .where(eq(users.spotifyId, profile.id));
    
    let userId;
    
    if (existingUsers.length > 0) {
      // Update existing user
      const user = existingUsers[0];
      userId = user.id;
      
      await db
        .update(users)
        .set({
          displayName: profile.display_name,
          avatarUrl: profile.images?.[0]?.url || null,
          lastActiveAt: new Date()
        })
        .where(eq(users.id, userId));
    } else {
      // Create new user with username based on Spotify ID
      const username = `user_${profile.id.substring(0, 8)}`;
      
      const [newUser] = await db
        .insert(users)
        .values({
          id: uuidv4(),
          username: username,
          displayName: profile.display_name,
          avatarUrl: profile.images?.[0]?.url || null,
          spotifyId: profile.id,
          lastActiveAt: new Date()
        })
        .returning();
      
      userId = newUser.id;
    }
    
    res.json({ 
      success: true, 
      userId,
      username: existingUsers[0]?.username || `user_${profile.id.substring(0, 8)}`
    });
  } catch (error) {
    console.error("Error storing user:", error);
    res.status(500).json({ error: "Failed to store user data" });
  }
});

// Store tracks
app.post("/api/spotify/store-tracks", async (req, res) => {
  const { userId, tracks: trackData, type = "top" } = req.body;
  
  if (!userId || !trackData || !Array.isArray(trackData)) {
    return res.status(400).json({ error: "Invalid data format" });
  }
  
  try {
    // Process tracks and store in database
    const savedTracks = [];
    
    for (const track of trackData) {
      // Insert track
      const [savedTrack] = await db
        .insert(tracks)
        .values({
          title: track.name,
          artist: track.artists?.map(a => a.name).join(", "),
          album: track.album?.name,
          duration: Math.round(track.duration_ms / 1000),
          source: "spotify",
          sourceUrl: track.external_urls?.spotify
        })
        .onConflictDoUpdate({
          target: [tracks.sourceUrl],
          set: {
            title: track.name,
            artist: track.artists?.map(a => a.name).join(", "),
            album: track.album?.name
          }
        })
        .returning();
      
      savedTracks.push(savedTrack);
      
      // Create feed event
      await db
        .insert(feedEvents)
        .values({
          userId,
          eventType: type === "top" ? "top_track" : "recently_played",
          trackId: savedTrack.id,
          context: type === "top" 
            ? { rank: trackData.indexOf(track) + 1 } 
            : { played_at: track.played_at }
        });
    }
    
    res.json({ success: true, count: savedTracks.length });
  } catch (error) {
    console.error("Error storing tracks:", error);
    res.status(500).json({ error: "Failed to store track data" });
  }
});

app.get("/auth/login", (req, res) => {
  const scope = 'user-read-private user-read-email user-top-read user-library-read user-read-recently-played';

  const authUrl =
    'https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: ENV.SPOTIFY_CLIENT_ID,
      scope: scope,
      redirect_uri: ENV.REDIRECT_URI,
    });

  res.redirect(authUrl);
});

app.get("/auth/callback", async (req, res) => {
  const code = req.query.code || null;

  try {
    const tokenResponse = await axios.post(
      'https://accounts.spotify.com/api/token',
      querystring.stringify({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: ENV.REDIRECT_URI,
      }),
      {
        headers: {
          Authorization:
            'Basic ' +
            Buffer.from(ENV.SPOTIFY_CLIENT_ID + ':' + ENV.SPOTIFY_CLIENT_SECRET).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    // Get user profile
    const profileResponse = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    
    const profile = profileResponse.data;
    
    // For testing purposes, log the tokens
    console.log('Access token:', access_token);

    // Return user info and tokens in a way the client can capture
    res.send(`
      <html>
        <body>
          <h1>Login successful!</h1>
          <p>You can close this window.</p>
          <script>
            // Store tokens and profile data in localStorage
            window.opener.postMessage(
              {
                type: 'SPOTIFY_AUTH_SUCCESS',
                profile: ${JSON.stringify(profile)},
                tokens: {
                  access_token: '${access_token}',
                  refresh_token: '${refresh_token}',
                  expires_in: ${expires_in}
                }
              }, 
              '*'
            );
            // Close this window
            window.close();
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('Error getting Spotify tokens:', err.response?.data || err);
    res.send(`
      <html>
        <body>
          <h1>Login failed</h1>
          <p>Error: ${err.message}</p>
          <script>
            window.opener.postMessage(
              {
                type: 'SPOTIFY_AUTH_ERROR',
                error: '${err.message}'
              }, 
              '*'
            );
            // Close this window
            setTimeout(() => window.close(), 5000);
          </script>
        </body>
      </html>
    `);
  }
});

app.listen(PORT, () => {
  console.log("Server is running on PORT:", PORT);
});
import express from "express";

import {ENV} from "./config/env.js";
import axios from "axios";
import querystring from "querystring";

const app = express()
const PORT = ENV.PORT || 8001


//client id test
console.log("Client ID:", ENV.SPOTIFY_CLIENT_ID);


app.get("/api/health", (req,res) => {
    res.status(200).json({ success: true})
});

app.get("/auth/login", (req, res) => {
    const scope = 'user-read-private user-read-email user-top-read user-library-read';
  
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
  
      console.log('Access token:', access_token);
  
      res.send('Login success! You can close this window.');
    } catch (err) {
      console.error('Error getting Spotify tokens:', err.response?.data || err);
      res.send('Error during Spotify login');
    }
  });


app.listen(PORT, () => {

    console.log("Server is running on PORT:", PORT)
})
 
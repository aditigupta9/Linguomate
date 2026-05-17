import { exec } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { promises as fs } from "fs";
import axios from "axios";

dotenv.config();

const groqApiKey = process.env.GROQ_API_KEY;
const groqUrl = "https://api.groq.com/openai/v1/chat/completions";
const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
const voiceID = "XfNU2rGpBa01ckF309OY";
const elevenLabsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceID}`;

const app = express();
app.use(express.json());
app.use(cors());
const port = 3000;


let conversationHistory = [];

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/voices", async (req, res) => {
  try {
    const voices = await voice.getVoices(elevenLabsApiKey);
    res.send(voices);
  } catch (error) {
    console.error("Error fetching voices:", error.message);
    res.status(500).send({ error: "Failed to fetch voices" });
  }
});

const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
};

const lipSyncMessage = async (messageId) => {
  const time = Date.now();
  const inputMp3 = `audios/message_${messageId}.mp3`;
  const outputWav = `audios/message_${messageId}.wav`;
  const outputJson = `audios/message_${messageId}.json`;

  // Check if MP3 file exists
  try {
    await fs.access(inputMp3);
  } catch (err) {
    throw new Error(`MP3 file not found: ${inputMp3}. TTS generation may have failed.`);
  }

  console.log(`Starting conversion for message ${messageId}`);
  await execCommand(`ffmpeg -y -i "${inputMp3}" "${outputWav}"`);
  console.log(`Conversion done in ${Date.now() - time}ms`);

  const rhubarbPath = '/Users/deepakkr/Deepakkr/College/sem4/PbL-2/LinguoMate/bin/rhubarb/bin/rhubarb';

  console.log(`Running rhubarb...`);
  await execCommand(`"${rhubarbPath}" -f json -o "${outputJson}" "${outputWav}" -r phonetic`);
  console.log(`Lip sync done in ${Date.now() - time}ms`);

  try {
    const jsonContent = await fs.readFile(outputJson, 'utf8');
    JSON.parse(jsonContent);
    console.log('Lip sync JSON is valid.');
  } catch (error) {
    console.error('Lip sync JSON is invalid:', error.message);
  }
};

const readJsonTranscript = async (file) => {
  const data = await fs.readFile(file, "utf8");
  return JSON.parse(data);
};

const audioFileToBase64 = async (file) => {
  const data = await fs.readFile(file);
  return data.toString("base64");
};

const generateTTS = async (text, fileName) => {
  try {
    const response = await axios.post(
      elevenLabsUrl,
      { text: text, model_id: "eleven_monolingual_v1", voice_settings: { stability: 0.5, similarity_boost: 0.75 } },
      {
        headers: {
          "xi-api-key": elevenLabsApiKey,
          "Content-Type": "application/json",
        },
        responseType: "arraybuffer",
      }
    );
    
    await fs.writeFile(fileName, response.data);
    console.log(`Generated TTS: ${fileName}`);
  } catch (error) {
    console.error(`TTS Error for "${text}":`, error.response?.data?.detail || error.message);
    throw new Error(`TTS Generation failed: ${error.response?.data?.detail || error.message}`);
  }
};

app.post("/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;


    
    conversationHistory.push({ role: "user", content: userMessage });

    
    const groqResponse = await axios.post(
      groqUrl,
      {
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content: `
You are a VirtualTutor.
You must reply ONLY with raw JSON and can explain about conversation if needed.
Just a raw JSON array like:

[
  { "text": "Hey, darling!", "facialExpression": "smile", "animation": "Talking_1" },
  { "text": "I missed you!", "facialExpression": "sad", "animation": "Crying" }
]

The allowed facial expressions are: smile, sad, angry, surprised, funnyFace, and default.
The allowed animations are: Talking_0, Talking_1, Talking_2, Crying, Laughing, Rumba, Idle, Terrified, and Angry.
            `
          },
          ...conversationHistory
        ],
        temperature: 0.6,
        max_tokens: 1000,
      },
      {
        headers: {
          Authorization: `Bearer ${groqApiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    let messages = JSON.parse(groqResponse.data.choices[0].message.content);
    if (messages.messages) messages = messages.messages;

    const messageIndex = Math.floor(conversationHistory.length / 2);

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const fileName = `audios/message_${messageIndex}_${i}.mp3`;

      await generateTTS(message.text, fileName);
      await lipSyncMessage(`${messageIndex}_${i}`);

      message.audio = await audioFileToBase64(fileName);
      message.lipsync = await readJsonTranscript(`audios/message_${messageIndex}_${i}.json`);

      
      conversationHistory.push({ role: "assistant", content: message.text });
    }

    res.send({ messages });

  } catch (error) {
    if (error.response?.data) {
      const errorData = error.response.data;
      if (Buffer.isBuffer(errorData)) {
        console.error("Error in /chat:", errorData.toString("utf8"));
      } else {
        console.error("Error in /chat:", errorData);
      }
    } else {
      console.error("Error in /chat:", error.message);
    }
    res.status(500).send({ error: "Failed to process chat." });
  }
});

app.post("/reset", (req, res) => {
  conversationHistory = [];
  res.send({ message: " Conversation history has been reset." });
});

app.listen(port, () => {
  console.log(`Virtual Tutor is listening on port ${port}`);
});

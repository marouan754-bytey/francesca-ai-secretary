import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

dotenv.config();

const configPath = path.join(process.cwd(), 'config.yaml');
let yamlConfig = {};

if (fs.existsSync(configPath)) {
  try {
    const fileContents = fs.readFileSync(configPath, 'utf8');
    yamlConfig = yaml.load(fileContents);
  } catch (e) {
    console.error('Error loading config.yaml:', e);
  }
}

export const config = {
  port: process.env.PORT || 3030,
  proxyUrl: process.env.PROXY_URL || 'http://localhost:4000/v1/chat/completions',
  masterKey: yamlConfig.general_settings?.master_key || 'sk-mj-center',
  adminJid: process.env.ADMIN_JID || '109358826397739@lid',
  groqApiKey: process.env.GROQ_API_KEY,
  deepinfraToken: process.env.DEEPINFRA_TOKEN,
  models: yamlConfig.model_list || [],
};

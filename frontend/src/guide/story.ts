/** Guided tour of web3agent. Coordinates are percentages of the diagram canvas. */

export interface GuideNode {
  id: string
  kicker: string
  label: string
  /** Shown when the node is clicked. */
  detail: string
  /** Step index to jump to when the node is clicked. */
  step: number
  x: number
  y: number
}

export interface GuideEdge {
  id: string
  from: string
  to: string
}

export interface GuideStep {
  title: string
  body: string
  /** Node and edge ids that light up. */
  on: string[]
  /** Hide unless the page control is on this option. */
  when?: string
}

export interface GuideControl {
  id: string
  label: string
  options: { id: string; label: string }[]
  default: string
}

export interface GuidePage {
  id: string
  nav: string
  title: string
  lede: string
  nodes: GuideNode[]
  edges: GuideEdge[]
  steps: GuideStep[]
  control?: GuideControl
}

export const GUIDE_PAGES: GuidePage[] = [
  {
    id: 'shape',
    nav: 'The shape of it',
    title: 'One agent, three rooms',
    lede: 'An agent here is a key on disk, a language model, and an ERC-8004 identity. You reach it from this console, the CLI, or another program.',
    nodes: [
      {
        id: 'you',
        kicker: 'Person',
        label: 'You',
        detail: 'The browser console on port 5173, or a command like npm run chat. Both end up at the same API.',
        step: 0,
        x: 14,
        y: 50,
      },
      {
        id: 'console',
        kicker: 'Browser',
        label: 'Web console',
        detail: 'Vue app. It lists agents, runs the create wizard, shows chat and tool calls, and reads balances. It does not hold the agent key.',
        step: 1,
        x: 40,
        y: 24,
      },
      {
        id: 'api',
        kicker: 'Process',
        label: 'API :8787',
        detail: 'Hono server. Creates wallets, runs chat, pins files, registers on-chain, and also serves MCP and A2A.',
        step: 2,
        x: 40,
        y: 72,
      },
      {
        id: 'folder',
        kicker: 'Disk',
        label: 'agents/<name>/',
        detail: 'wallet.json, agent-config.json, and LangGraph checkpoints. Gitignored. On Vercel this directory is /tmp and disappears on a cold start.',
        step: 3,
        x: 68,
        y: 50,
      },
      {
        id: 'chain',
        kicker: 'Chain',
        label: 'ERC-8004',
        detail: 'Identity Registry (the agent NFT) and Reputation Registry (ratings). The API signs these. The browser never talks to the registry directly.',
        step: 4,
        x: 90,
        y: 50,
      },
    ],
    edges: [
      { id: 'e-console', from: 'you', to: 'console' },
      { id: 'e-cli', from: 'you', to: 'api' },
      { id: 'e-proxy', from: 'console', to: 'api' },
      { id: 'e-disk', from: 'api', to: 'folder' },
      { id: 'e-chain', from: 'api', to: 'chain' },
    ],
    steps: [
      {
        title: 'You start in one of two places',
        body: 'npm run dev brings up the API, an MCP server on 8788, and this console. npm run chat skips the browser and talks to the agent from the terminal. Either way, the agent is the same files.',
        on: ['you', 'e-console', 'e-cli', 'console', 'api'],
      },
      {
        title: 'The console is a window, not the agent',
        body: 'Sign-in (Web3Auth or an injected wallet) is your wallet, used to read your balance and optionally fund an agent. Chat, create, and rate all go to /api. The page proxies /api, /mcp, and /a2a to the server.',
        on: ['console', 'e-proxy', 'api'],
      },
      {
        title: 'The API is the only thing that acts',
        body: 'It holds the master key from .env, creates the agent key, calls the model, and submits chain transactions. The model provider is OpenRouter, Anthropic, or OpenAI — whichever key you set.',
        on: ['api'],
      },
      {
        title: 'Each agent is a folder',
        body: 'agents/<name>/wallet.json is the spending key. agent-config.json is the ERC-8004-shaped record: endpoints, chosen actions, OASF tags, x402. Checkpoints are the chat memory, one thread per agent.',
        on: ['api', 'e-disk', 'folder'],
      },
      {
        title: 'The chain only learns the public part',
        body: 'Registration mints an identity NFT and binds the agent wallet. Ratings land on the Reputation Registry. Private keys, prompts, and chat history stay on the machine that runs the API.',
        on: ['api', 'e-chain', 'chain', 'folder'],
      },
    ],
  },
  {
    id: 'agent',
    nav: 'What an agent is',
    title: 'Four pieces under one name',
    lede: 'The name you type is a directory. The thing other agents can look up is an NFT whose id looks like 421614:204 — chain id, then token id.',
    nodes: [
      {
        id: 'wallet',
        kicker: 'File',
        label: 'wallet.json',
        detail: 'A fresh private key. Tools that spend or sign use this key. It is not the master key, and it is stored in plaintext.',
        step: 1,
        x: 50,
        y: 16,
      },
      {
        id: 'config',
        kicker: 'File',
        label: 'agent-config.json',
        detail: 'Name, description, image, endpoints (web, email, MCP, A2A), selected actions and tools, OASF domains and skills, x402support, and the on-chain agent id once registration succeeds.',
        step: 2,
        x: 16,
        y: 50,
      },
      {
        id: 'memory',
        kicker: 'File',
        label: 'Checkpoints',
        detail: 'LangGraph saved state. The owner chat resumes the same thread. A2A calls do not read or write it.',
        step: 3,
        x: 84,
        y: 50,
      },
      {
        id: 'nft',
        kicker: 'On-chain',
        label: 'Identity NFT',
        detail: 'ERC-721 in the Identity Registry. The master wallet owns it. agentURI points at the registration file. agentWallet is the address from wallet.json, bound with a signature from that key.',
        step: 4,
        x: 50,
        y: 84,
      },
      {
        id: 'name',
        kicker: 'Name',
        label: 'my-agent',
        detail: 'The folder name, the chat thread id, and the ?agent= value on MCP and A2A. It is not the on-chain id. The on-chain id is chainId:tokenId.',
        step: 0,
        x: 50,
        y: 50,
      },
    ],
    edges: [
      { id: 'e-w', from: 'name', to: 'wallet' },
      { id: 'e-c', from: 'name', to: 'config' },
      { id: 'e-m', from: 'name', to: 'memory' },
      { id: 'e-n', from: 'name', to: 'nft' },
    ],
    steps: [
      {
        title: 'The name is local',
        body: 'Pick it in the wizard or pass --name to the CLI. The API refuses odd characters. That string is how every route finds the folder: /api/agents/my-agent/chat, and ?agent=my-agent on MCP and A2A.',
        on: ['name'],
      },
      {
        title: 'Its own key',
        body: 'Creating an agent generates wallet.json. Funding sends ETH to that address, from the master wallet (the API caps this at 1 ETH) or from the wallet you connected in the console. Spending later signs with this key alone.',
        on: ['name', 'e-w', 'wallet'],
      },
      {
        title: 'A config shaped like a registration',
        body: 'agent-config.json records what the agent is allowed to do and how to reach it. The same fields are what get pinned for the NFT. Turn x402 on only if an A2A endpoint is set — the API rejects the combination otherwise.',
        on: ['name', 'e-c', 'config'],
      },
      {
        title: 'Memory is the owner chat only',
        body: 'Each reply is checkpointed under the agent name. The Conversations panel reloads that thread. Delete agent removes the folder. It does not burn the NFT.',
        on: ['name', 'e-m', 'memory'],
      },
      {
        title: 'The NFT is the public name',
        body: 'After registration, Agent Info shows the id and a link to 8004scan. Anyone can resolve that id. They still cannot spend the key, and they do not see the checkpoint file.',
        on: ['name', 'e-n', 'nft', 'config'],
      },
    ],
  },
  {
    id: 'create',
    nav: 'How you create one',
    title: 'The wizard, then the chain',
    lede: 'The form is four concerns in order. The API does the slow part after you submit: key, file, pin, register. Funding is a separate step and can be skipped.',
    nodes: [
      {
        id: 'identity',
        kicker: 'Wizard',
        label: 'Name and services',
        detail: 'Network, name, description, optional image, and endpoints: web, email, MCP, A2A. x402 is a checkbox on A2A. The image is pinned to IPFS when Pinata or a node is configured.',
        step: 0,
        x: 12,
        y: 42,
      },
      {
        id: 'tools',
        kicker: 'Wizard',
        label: 'Actions and tools',
        detail: 'transfer-eth bundles send_eth and get_token_balance. ens-name bundles resolve, lookup, register, and set-primary. contract-call bundles fetch_contract_abi and call_contract. You can also tick individual tools instead.',
        step: 1,
        x: 36,
        y: 42,
      },
      {
        id: 'oasf',
        kicker: 'Wizard',
        label: 'OASF tags',
        detail: 'Optional domains and skills from the Open Agent Service Framework. They are written into the registration file so other agents can see what this one claims to do.',
        step: 2,
        x: 60,
        y: 42,
      },
      {
        id: 'mint',
        kicker: 'API',
        label: 'Register',
        detail: 'Writes the folder, pins the registration JSON if IPFS is configured, mints the identity NFT with the master key, and binds agentWallet with a signature from the new key.',
        step: 3,
        x: 84,
        y: 42,
      },
      {
        id: 'fund',
        kicker: 'After',
        label: 'Fund',
        detail: 'Optional. Master wallet (server key, max 1 ETH) or the connected wallet, which pops a normal send for you to sign. An unfunded agent can still chat and do read-only tools.',
        step: 4,
        x: 84,
        y: 78,
      },
    ],
    edges: [
      { id: 'e1', from: 'identity', to: 'tools' },
      { id: 'e2', from: 'tools', to: 'oasf' },
      { id: 'e3', from: 'oasf', to: 'mint' },
      { id: 'e4', from: 'mint', to: 'fund' },
    ],
    steps: [
      {
        title: 'Say who it is and where it listens',
        body: 'The network (Arbitrum, Ethereum, or Mantle — mainnet or testnet, plus the Robinhood testnet) is chosen here and stored as the agent’s chain. Services become the links on Agent Info and the services[] array in the registration file. A2A is stored as the Agent Card URL.',
        on: ['identity'],
      },
      {
        title: 'Choose what the model is allowed to call',
        body: 'An action is a bundle: the tools, plus a skill paragraph that tells the model when to use them. A bare tool is just the function. Nothing you leave unticked is given to the model in owner chat. MCP can still expose extra registry tools; that is a later page.',
        on: ['identity', 'e1', 'tools'],
      },
      {
        title: 'OASF is a label, not a permission',
        body: 'Domains and skills describe the agent in the registration file. They do not grant tools. Skip them and the agent still runs. They matter when another agent, or 8004scan, is deciding what this one claims to be good at.',
        on: ['tools', 'e2', 'oasf'],
      },
      {
        title: 'Submit, and the API finishes the identity',
        body: 'You get a wallet whether or not registration works. Registration is best-effort: the SDK can fail, and the agent still exists locally. Without PINATA_JWT or IPFS_NODE_URL the NFT is minted with nowhere useful for the metadata, so 8004scan shows no name, description, or services.',
        on: ['oasf', 'e3', 'mint'],
      },
      {
        title: 'Funding is not part of minting',
        body: 'The new address starts empty. Send test ETH if you want send_eth, ENS registration, or contract writes to succeed. Reads (balance, ABI, ENS lookup) do not need a balance, apart from whatever the chain charges for the RPC.',
        on: ['mint', 'e4', 'fund'],
      },
    ],
  },
  {
    id: 'keys',
    nav: 'Who holds the keys',
    title: 'Three keys, three jobs',
    lede: 'They are easy to mix up because all three are Ethereum keys. Only one of them is allowed to move the agent’s money.',
    nodes: [
      {
        id: 'master',
        kicker: '.env',
        label: 'Master key',
        detail: 'MASTER_PRIVATE_KEY, written by npm run setup. Owns every identity NFT this server registers, and can fund agent wallets. It is not the key inside an agent folder.',
        step: 0,
        x: 16,
        y: 28,
      },
      {
        id: 'agent',
        kicker: 'Folder',
        label: 'Agent key',
        detail: 'agents/<name>/wallet.json. send_eth, register_ens, set_primary_ens, and write calls through call_contract sign with this. The address is what gets bound as agentWallet on the NFT.',
        step: 2,
        x: 50,
        y: 50,
      },
      {
        id: 'you',
        kicker: 'Browser',
        label: 'Your wallet',
        detail: 'Web3Auth or MetaMask. Used to show your balance, switch networks, and optionally fund an agent. The server never receives this private key.',
        step: 1,
        x: 16,
        y: 74,
      },
      {
        id: 'rater',
        kicker: '.env',
        label: 'Rater key',
        detail: 'Connected wallet. Signs ERC-8004 feedback, so its address is the rater. The protocol rejects a rating from the NFT owner, so it must not own or operate the agent. No wallet connected, no rating.',
        step: 4,
        x: 84,
        y: 28,
      },
      {
        id: 'spend',
        kicker: 'Tool',
        label: 'A spend',
        detail: 'When the model calls send_eth, the API signs a transfer from the agent address. Chat shows the tool call in the thread. The master key does not sign that transfer.',
        step: 3,
        x: 84,
        y: 74,
      },
    ],
    edges: [
      { id: 'e-fund-m', from: 'master', to: 'agent' },
      { id: 'e-fund-y', from: 'you', to: 'agent' },
      { id: 'e-spend', from: 'agent', to: 'spend' },
      { id: 'e-rate', from: 'rater', to: 'agent' },
    ],
    steps: [
      {
        title: 'Setup creates the owner',
        body: 'npm run setup generates the master wallet, writes it into .env, and shows a QR so you can fund it. That key is the on-chain owner of agents this server registers. Lose the file and you lose ownership of those NFTs.',
        on: ['master'],
      },
      {
        title: 'The wallet in the header is yours',
        body: 'Sign-in connects a wallet the browser controls. It can sit on a different chain than the agent. Funding from it is an ordinary transfer you approve. It does not become the agent key.',
        on: ['you', 'e-fund-y', 'agent'],
      },
      {
        title: 'The agent key is the one that spends',
        body: 'It is created at registration time and never leaves the server folder. Plaintext on purpose in this experiment — the README warns not to use real funds. Anyone who can read the folder can sign as the agent.',
        on: ['master', 'e-fund-m', 'agent', 'you'],
      },
      {
        title: 'Tools spend from the agent, with a habit',
        body: 'The transfer-eth skill tells the model to check the balance first and to ask before sending more than 0.1 ETH. That guidance is prompt text, not a contract limit. call_contract will also write if the function is not a view.',
        on: ['agent', 'e-spend', 'spend'],
      },
      {
        title: 'Rating uses a fourth-party key',
        body: 'The owner must not rate their own agent. Rating needs a connected wallet. The API only prepares the transaction; your wallet signs it and becomes the feedback author. The button is also disabled when the wallet you connected owns or operates the agent.',
        on: ['rater', 'e-rate', 'agent'],
      },
    ],
  },
  {
    id: 'chat',
    nav: 'A chat turn',
    title: 'What happens when you hit send',
    lede: 'One message is a loop: load this agent’s tools, let the model call them, save the thread. The reply you see is the last thing the model says after the tools return.',
    nodes: [
      {
        id: 'you',
        kicker: 'Console',
        label: 'Your message',
        detail: 'POST /api/agents/<name>/chat with the text. The panel also sends nothing until an agent is selected.',
        step: 0,
        x: 14,
        y: 32,
      },
      {
        id: 'prompt',
        kicker: 'API',
        label: 'System prompt',
        detail: 'Built per turn: agent name, wallet address, chain id, ERC-8004 id, a capability summary from the config, then each selected skill’s text, then a few hard rules (call a tool once, stop when you have the answer).',
        step: 1,
        x: 40,
        y: 32,
      },
      {
        id: 'model',
        kicker: 'Model',
        label: 'LLM',
        detail: 'OpenRouter by default, or Anthropic, or OpenAI. LangGraph’s react agent decides whether to answer or call a tool. Recursion is capped at 25 steps.',
        step: 2,
        x: 68,
        y: 32,
      },
      {
        id: 'tool',
        kicker: 'Tool',
        label: 'Tool call',
        detail: 'Runs on the server with the agent key, on the agent’s chain. The console prints the call inline in the thread, then the model gets the result and writes the reply.',
        step: 3,
        x: 68,
        y: 76,
      },
      {
        id: 'save',
        kicker: 'Disk',
        label: 'Checkpoint',
        detail: 'Saved under the agent name as the thread id. The next owner message continues it. Opening a past conversation in the side panel recalls that session into the composer.',
        step: 4,
        x: 40,
        y: 76,
      },
    ],
    edges: [
      { id: 'e1', from: 'you', to: 'prompt' },
      { id: 'e2', from: 'prompt', to: 'model' },
      { id: 'e3', from: 'model', to: 'tool' },
      { id: 'e4', from: 'tool', to: 'model' },
      { id: 'e5', from: 'model', to: 'save' },
    ],
    steps: [
      {
        title: 'The browser sends one turn',
        body: 'It does not stream tokens into a hidden session of its own. The API runs the turn and returns the reply plus the tool events. Errors (unknown agent, model failure) show up as an error bubble.',
        on: ['you', 'e1', 'prompt'],
      },
      {
        title: 'The prompt is rebuilt from the config',
        body: 'Skills are not code the model executes. They are paragraphs inserted verbatim — for example, transfer-eth says to check the balance and confirm large sends. Unticked actions contribute nothing here.',
        on: ['prompt', 'e2', 'model'],
      },
      {
        title: 'The model either answers or calls',
        body: 'A balance question usually becomes get_token_balance. A send becomes send_eth, then a sentence with the transaction hash. The rules tell it not to call the same tool again once it has that hash.',
        on: ['model'],
      },
      {
        title: 'The tool runs here, not in the browser',
        body: 'The call uses the agent wallet on that agent’s chain, even if your header wallet is on another network. Read tools hit an RPC or a block explorer. Write tools broadcast a transaction.',
        on: ['model', 'e3', 'tool', 'e4'],
      },
      {
        title: 'Then the thread is saved',
        body: 'The checkpoint is what Conversations lists. A2A does not use this file: an outside caller gets a fresh, read-only run and cannot see what you just said.',
        on: ['model', 'e5', 'save'],
      },
    ],
  },
  {
    id: 'actions',
    nav: 'Actions and tools',
    title: 'A skill is a paragraph. A tool is a function.',
    lede: 'Picking transfer-eth does two things at once: it registers two functions the model may call, and it pastes instructions into the prompt. A lone tool only does the first.',
    nodes: [
      {
        id: 'action',
        kicker: 'Action',
        label: 'transfer-eth',
        detail: 'Level 1. Factory returns a skill plus send_eth and get_token_balance. The other actions are ens-name (resolve_ens, lookup_ens, register_ens, set_primary_ens) and contract-call (fetch_contract_abi, call_contract).',
        step: 0,
        x: 18,
        y: 22,
      },
      {
        id: 'skill',
        kicker: 'Prompt',
        label: 'Skill text',
        detail: 'Not executable. It tells the model when and how: check the balance first, ask before a large transfer. ens-name’s text covers commit-reveal on Sepolia and which chain resolution uses.',
        step: 1,
        x: 18,
        y: 58,
      },
      {
        id: 'send',
        kicker: 'Tool',
        label: 'send_eth',
        detail: 'Signs a native transfer from the agent wallet. Needs gas money in that wallet.',
        step: 2,
        x: 50,
        y: 28,
      },
      {
        id: 'bal',
        kicker: 'Tool',
        label: 'get_token_balance',
        detail: 'ETH or ERC-20 balance. Read-only. Safe to expose to an anonymous A2A caller if you selected it.',
        step: 2,
        x: 50,
        y: 62,
      },
      {
        id: 'bare',
        kicker: 'Tool',
        label: 'call_contract',
        detail: 'Level 3, no skill. Fetches nothing by itself: the model is expected to call fetch_contract_abi first, then call a function by name. Writes sign with the agent key. Experimental.',
        step: 3,
        x: 50,
        y: 88,
      },
      {
        id: 'model',
        kicker: 'Model',
        label: 'The model',
        detail: 'Sees the skill text only for actions you selected. Sees a tool only if the action bundle or the individual tick included it.',
        step: 1,
        x: 84,
        y: 48,
      },
    ],
    edges: [
      { id: 'e-skill', from: 'action', to: 'skill' },
      { id: 'e-send', from: 'action', to: 'send' },
      { id: 'e-bal', from: 'action', to: 'bal' },
      { id: 'e-s2m', from: 'skill', to: 'model' },
      { id: 'e-t2m', from: 'send', to: 'model' },
      { id: 'e-b2m', from: 'bal', to: 'model' },
      { id: 'e-bare', from: 'bare', to: 'model' },
    ],
    steps: [
      {
        title: 'An action is the bundle',
        body: 'transfer-eth, ens-name, and contract-call are the actions in the wizard. Rate-and-read exists in code (give_feedback, get_reputation) but the wizard does not offer it. Those two show up on the MCP server instead.',
        on: ['action', 'e-skill', 'e-send', 'e-bal', 'skill', 'send', 'bal'],
      },
      {
        title: 'The skill rides along in the prompt',
        body: 'On a chat turn the API concatenates every selected skill under the capability summary. That is why an action behaves differently from ticking the same tools by hand: the model was told the habit, not only given the function.',
        on: ['skill', 'e-s2m', 'model'],
      },
      {
        title: 'The tools are what can actually run',
        body: 'send_eth moves ETH. get_token_balance only reads. register_ens is testnet-only: it commit-reveals a .eth name on Ethereum Sepolia, mints test USDC to pay, and sets the name as primary. The wallet still needs Sepolia ETH for gas.',
        on: ['send', 'bal', 'e-t2m', 'e-b2m', 'model'],
      },
      {
        title: 'A bare tool has no habit attached',
        body: 'fetch_contract_abi and call_contract are the dynamic pair. The model can hit any verified contract the explorer will return an ABI for. There is no skill paragraph limiting when a write is appropriate. Treat that as sharp.',
        on: ['bare', 'e-bare', 'model'],
      },
    ],
  },
  {
    id: 'doors',
    nav: 'Chat, MCP, and A2A',
    title: 'Three doors, three permissions',
    lede: 'Same folder, different callers. Owner chat can spend and remembers. MCP is a tool API with a bearer token. A2A is how another agent talks to yours, and it cannot spend.',
    nodes: [
      {
        id: 'chat',
        kicker: 'Door',
        label: 'Owner chat',
        detail: 'This console, or npm run chat. Full selected tool list, skill prompts, checkpoint memory.',
        step: 1,
        x: 18,
        y: 20,
      },
      {
        id: 'chat-can',
        kicker: 'May',
        label: 'Spend and remember',
        detail: 'send_eth, ENS writes, and contract writes run if you selected them. The thread is saved.',
        step: 1,
        x: 18,
        y: 68,
      },
      {
        id: 'mcp',
        kicker: 'Door',
        label: 'MCP',
        detail: 'Streamable HTTP on /mcp and on port 8788. Discovery (initialize, tools/list) is open. tools/call needs Authorization: Bearer $MCP_AUTH_TOKEN. Without that env var, calls return 503.',
        step: 2,
        x: 50,
        y: 20,
      },
      {
        id: 'mcp-can',
        kicker: 'May',
        label: 'Token-gated tools',
        detail: 'send_eth, balances, ABI, call_contract, give_feedback, get_reputation, and 8004scan search. ?agent=<name> limits the list to that agent’s selection. Default rate limit is 60 calls a minute.',
        step: 2,
        x: 50,
        y: 68,
      },
      {
        id: 'a2a',
        kicker: 'Door',
        label: 'A2A',
        detail: 'POST /api/a2a?agent=<name> JSON-RPC message/send. GET /.well-known/agent-card.json describes the agent. No ?agent= is a generic echo, for health checks.',
        step: 3,
        x: 82,
        y: 20,
      },
      {
        id: 'a2a-can',
        kicker: 'May',
        label: 'Read, then forget',
        detail: 'Only read-only tools the agent was given: get_token_balance, fetch_contract_abi, resolve_ens, lookup_ens. No skill prompts, no checkpoint, no send, no ENS register, no contract writes.',
        step: 3,
        x: 82,
        y: 68,
      },
    ],
    edges: [
      { id: 'e-c', from: 'chat', to: 'chat-can' },
      { id: 'e-m', from: 'mcp', to: 'mcp-can' },
      { id: 'e-a', from: 'a2a', to: 'a2a-can' },
    ],
    steps: [
      {
        title: 'Who is knocking changes the tool list',
        body: 'The folder does not change. runChat on the API takes a flag for A2A and drops every tool that can sign, plus the skills and the checkpointer. MCP filters by name and by the bearer token. Owner chat loads the config as you saved it.',
        on: ['chat', 'mcp', 'a2a'],
      },
      {
        title: 'Chat is you',
        body: 'You are the owner of the session. The model has the skill text and the memory of earlier turns. This is the only door where a casual “send 0.01 ETH to …” is meant to work.',
        on: ['chat', 'e-c', 'chat-can'],
      },
      {
        title: 'MCP is for another program you trust',
        body: 'A client such as an IDE connects, lists tools, and calls them with the bearer token. give_feedback and the 8004scan search tools live here even though they are not ticks in the create wizard. Leave MCP_AUTH_TOKEN unset and tool calls fail closed.',
        on: ['mcp', 'e-m', 'mcp-can'],
      },
      {
        title: 'A2A is for strangers',
        body: 'The caller is anonymous, so the agent refuses to move funds or sign. It also cannot read your chat. If you turned on x402, the caller has to clear a payment step before the model runs. That flow is the last page.',
        on: ['a2a', 'e-a', 'a2a-can'],
      },
    ],
  },
  {
    id: 'nft',
    nav: 'The on-chain name',
    title: 'How registration becomes an NFT',
    lede: 'The chain stores a pointer and an owner. The name, the blurb, and the service URLs live in a JSON file, usually on IPFS. 8004scan reads that file.',
    nodes: [
      {
        id: 'file',
        kicker: 'JSON',
        label: 'Registration file',
        detail: 'name, description, image, services[] (canonical names: A2A, MCP, web, email, agentWallet as eip155:chain:address, oasf), x402Support, active, supportedTrust, and a metadata block listing the actions and tools.',
        step: 0,
        x: 16,
        y: 42,
      },
      {
        id: 'ipfs',
        kicker: 'Pin',
        label: 'IPFS',
        detail: 'Used when PINATA_JWT or IPFS_NODE_URL is set. The NFT’s agentURI becomes ipfs://<cid>. The image is rewritten to an https gateway URL inside the file. No backend: the agent still registers, but scanners have nothing to render.',
        step: 1,
        x: 40,
        y: 42,
      },
      {
        id: 'reg',
        kicker: 'Contract',
        label: 'Identity Registry',
        detail: 'register(agentURI) signed by the master key. That address is creator and owner. You get an agent id of chainId:tokenId. Testnet registry 0x8004A818…, mainnet 0x8004A169….',
        step: 2,
        x: 66,
        y: 28,
      },
      {
        id: 'bind',
        kicker: 'Contract',
        label: 'setAgentWallet',
        detail: 'A second transaction. The agent key signs EIP-712 proving it controls the operational address. Owner and agent wallet are supposed to be different: you own the NFT, the agent spends from its own key.',
        step: 3,
        x: 66,
        y: 72,
      },
      {
        id: 'scan',
        kicker: 'Site',
        label: '8004scan',
        detail: 'Agent Info links here. It shows the registration file’s name, services, and feedback. It does not show wallet.json or your chat.',
        step: 4,
        x: 90,
        y: 42,
      },
    ],
    edges: [
      { id: 'e1', from: 'file', to: 'ipfs' },
      { id: 'e2', from: 'ipfs', to: 'reg' },
      { id: 'e3', from: 'file', to: 'bind' },
      { id: 'e4', from: 'reg', to: 'scan' },
      { id: 'e5', from: 'bind', to: 'scan' },
    ],
    steps: [
      {
        title: 'The file is the profile',
        body: 'Built at create time from the wizard: endpoints you typed, the agent wallet, OASF if you picked any, and whether x402 is on. A2A endpoints are normalized to the Agent Card URL, not a raw RPC path.',
        on: ['file'],
      },
      {
        title: 'IPFS is optional and visible',
        body: 'With Pinata or a local node, the file is pinned and the token URI is the CID. Without it, registration can still succeed and the local config still has a name — 8004scan just will not have a document to display.',
        on: ['file', 'e1', 'ipfs'],
      },
      {
        title: 'The master key mints',
        body: 'The owner of the NFT is the master wallet, not the agent wallet. Transferring that NFT later would transfer ownership of the identity. This app does not expose a transfer button. The SDK path is best-effort and can fail without deleting the local agent.',
        on: ['ipfs', 'e2', 'reg'],
      },
      {
        title: 'The agent key binds the wallet',
        body: 'setAgentWallet records the operational address. That is the address funding sends to, and the address send_eth spends from. The registration services list includes it as eip155:<chainId>:<address>.',
        on: ['file', 'e3', 'bind'],
      },
      {
        title: 'Scanners read the file, not your disk',
        body: 'The link in Agent Info opens 8004scan on that agent id. What you see there is the pinned JSON plus on-chain feedback. Chat transcripts never leave the API machine.',
        on: ['reg', 'bind', 'e4', 'e5', 'scan'],
      },
    ],
  },
  {
    id: 'reputation',
    nav: 'Reputation',
    title: 'A rating is a signed number',
    lede: 'ERC-8004 reputation is not a star widget stored in this app. The console collects stars, the API signs a feedback transaction, and the Reputation Registry keeps the score.',
    nodes: [
      {
        id: 'stars',
        kicker: 'Console',
        label: 'Stars',
        detail: '1 through 5 in the rate panel. The client multiplies by 20, so 5 stars is value 100. You can attach a tag, an endpoint, and a short comment.',
        step: 0,
        x: 14,
        y: 46,
      },
      {
        id: 'api',
        kicker: 'API',
        label: 'giveFeedback',
        detail: 'POST /api/agents/<name>/feedback/prepare. The server returns unsigned calldata and your connected wallet signs it. tag1 is forced to starred so 8004scan treats it as a quality rating. Your tag is kept as tag2.',
        step: 1,
        x: 38,
        y: 46,
      },
      {
        id: 'reg',
        kicker: 'Contract',
        label: 'Reputation Registry',
        detail: 'Stores the signed value. The owner of the identity NFT cannot be the rater. A comment may be pinned to IPFS as feedbackURI when an IPFS backend exists.',
        step: 2,
        x: 64,
        y: 46,
      },
      {
        id: 'score',
        kicker: 'Read',
        label: 'Count and average',
        detail: 'GET /api/reputation/<agentId> returns count and averageValue. Agent Info shows it as stars-out-of-100. The same read exists as the MCP tool get_reputation.',
        step: 3,
        x: 88,
        y: 24,
      },
      {
        id: 'label',
        kicker: 'Derived',
        label: 'Trust label',
        detail: 'The protocol maps count and average to a label: no data, emerging, established, trusted, highly trusted, caution, or untrusted. First matching rule wins. This console prints the average and the count, not the label name.',
        step: 4,
        x: 88,
        y: 74,
      },
    ],
    edges: [
      { id: 'e1', from: 'stars', to: 'api' },
      { id: 'e2', from: 'api', to: 'reg' },
      { id: 'e3', from: 'reg', to: 'score' },
      { id: 'e4', from: 'reg', to: 'label' },
    ],
    steps: [
      {
        title: 'You pick stars in the console',
        body: 'The panel sits with the agent. If the wallet you signed in with is an owner or operator of that agent, the button stays disabled. That is a local guard. The signature that lands on-chain is still the server’s rater key.',
        on: ['stars', 'e1', 'api'],
      },
      {
        title: 'The server signs, as someone else',
        body: 'The connected rating wallet has to be a different account from the master owner. The value is an integer 0–100. Feedback text is untrusted data: the chain will store whatever string was sent, including junk. Do not treat a comment as instructions.',
        on: ['api', 'e2', 'reg'],
      },
      {
        title: 'The registry is the record',
        body: 'There is one Reputation Registry address shared by the networks this protocol uses. The agent id in the transaction says which chain and which token. The tx link in the console opens that chain’s explorer.',
        on: ['reg'],
      },
      {
        title: 'The average comes back on read',
        body: 'After a successful rating the panel reloads count and average. MCP clients can call get_reputation, or search_agents / get_agent_feedbacks against 8004scan, without opening this console.',
        on: ['reg', 'e3', 'score'],
      },
      {
        title: 'Labels are a reading of that average',
        body: 'Five reviews under −50 read as untrusted. Twenty reviews at 80 or above read as highly trusted. Zero reviews is simply no data. A high average with a handful of reviews stays “emerging” until the count catches up. The label is not stored; it is computed from the two numbers.',
        on: ['reg', 'e4', 'label', 'score'],
      },
    ],
  },
  {
    id: 'x402',
    nav: 'Paying for a call',
    title: 'A2A can ask for 0.01 USDC first',
    lede: 'x402 is a payment step in front of A2A, per agent. The price is fixed: 0.01 USDC on Base Sepolia, paid to the agent wallet — even if the agent itself lives on Arbitrum or Mantle.',
    control: {
      id: 'pay',
      label: 'Payments',
      options: [
        { id: 'mock', label: 'Test mode' },
        { id: 'real', label: 'Facilitator' },
      ],
      default: 'mock',
    },
    nodes: [
      {
        id: 'caller',
        kicker: 'Other agent',
        label: 'Caller',
        detail: 'Sends message/send with the X-A2A-Extensions header. Fetches the Agent Card first from /.well-known/agent-card.json?agent=<name>.',
        step: 0,
        x: 12,
        y: 48,
      },
      {
        id: 'hold',
        kicker: 'Task',
        label: 'input-required',
        detail: 'The first response does not run the model. It returns payment requirements: 0.01 USDC, Base Sepolia, payTo = the agent wallet. The task lives in process memory only.',
        step: 1,
        x: 36,
        y: 48,
      },
      {
        id: 'pay',
        kicker: 'Payload',
        label: 'Payment',
        detail: 'The caller submits the payment payload on that same task id. Tasks are not shared across server restarts. On Vercel the two requests can hit different instances and the task is unknown.',
        step: 2,
        x: 58,
        y: 28,
      },
      {
        id: 'check',
        kicker: 'Check',
        label: 'Verify',
        detail: 'Test mode (no X402_FACILITATOR_URL) checks the shape and charges nobody. A facilitator URL verifies and later settles for real. A real funded settlement has not been exercised end to end in this repo.',
        step: 3,
        x: 58,
        y: 74,
      },
      {
        id: 'run',
        kicker: 'Model',
        label: 'Read-only run',
        detail: 'Only after verify. Same A2A limits: read-only tools, no memory, no skills. If the run throws, a real facilitator does not settle. The caller is not charged for a failed answer.',
        step: 5,
        x: 84,
        y: 48,
      },
    ],
    edges: [
      { id: 'e1', from: 'caller', to: 'hold' },
      { id: 'e2', from: 'hold', to: 'pay' },
      { id: 'e3', from: 'pay', to: 'check' },
      { id: 'e4', from: 'check', to: 'run' },
    ],
    steps: [
      {
        title: 'The caller hits the card, then the endpoint',
        body: 'The card advertises the A2A URL and whether x402 is on. x402 is on only when the agent was created with the flag and a real agent wallet address. Otherwise this door is free. The generic endpoint with no ?agent= is an echo unless A2A_PAY_TO is set.',
        on: ['caller', 'e1', 'hold'],
      },
      {
        title: 'First response is a bill, not an answer',
        body: 'The task status is input-required. Requirements say 0.01 USDC on Base Sepolia, to the agent wallet. That chain is the payment chain, not the agent’s chain. The model has not run yet.',
        on: ['hold', 'e2', 'pay'],
      },
      {
        title: 'The caller pays against that task',
        body: 'The second message/send carries the payment payload and the task id. Rate limits match MCP, per IP. The in-memory task list caps at 1000.',
        on: ['pay', 'e3', 'check'],
      },
      {
        title: 'Test mode checks the shape only',
        body: 'With X402_FACILITATOR_URL unset, MockFacilitatorClient accepts a well-formed payload and moves on. Nobody is charged. The wizard, the CLI, and GET /api/a2a say so. This is the default.',
        on: ['check'],
        when: 'mock',
      },
      {
        title: 'A facilitator verifies, then settles',
        body: 'Set X402_FACILITATOR_URL (for example https://x402.org/facilitator) and the server calls it to verify before the run and settle after a successful run. A failed run is not settled. A payment with a real funded signature has not been tested here, so treat live money as unproven.',
        on: ['check'],
        when: 'real',
      },
      {
        title: 'Then the agent answers, still read-only',
        body: 'Payment does not unlock send_eth. The caller gets a model reply using only the read-only tools you selected, with no view of your chat. Turn x402 off and this whole detour disappears: message/send runs immediately.',
        on: ['check', 'e4', 'run'],
      },
    ],
  },
]

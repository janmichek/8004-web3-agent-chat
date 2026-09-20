/**
 * OASF (Open Agentic Schema Framework) taxonomy snapshot.
 * Source: https://schema.oasf.outshift.com/
 *
 * Domains = top-level classes [1]–[18].
 * Skills = second-level capabilities (e.g. [101], [602]).
 * Leaf modules ([10101]…) are intentionally omitted — selection stops at skill level.
 */
export type OasfSkill = { id: string; name: string };
export type OasfDomain = { id: string; name: string; skills: OasfSkill[] };

export const OASF_SCHEMA_URL = 'https://schema.oasf.outshift.com/';
export const OASF_VERSION = '1.1.0';

export const OASF_DOMAINS: OasfDomain[] = [
  {
    id: '1',
    name: 'Language Processing',
    skills: [
      { id: '101', name: 'Language Understanding' },
      { id: '102', name: 'Text Classification' },
      { id: '103', name: 'Language Generation' },
      { id: '104', name: 'Language Translation' },
      { id: '105', name: 'Text Personalization' },
    ],
  },
  {
    id: '2',
    name: 'Computer Vision',
    skills: [
      { id: '201', name: 'Image Analysis' },
      { id: '202', name: 'Image Generation' },
      { id: '203', name: 'Image Editing' },
      { id: '204', name: 'Video' },
    ],
  },
  {
    id: '3',
    name: 'Audio & Speech Processing',
    skills: [
      { id: '301', name: 'Audio Analysis' },
      { id: '302', name: 'Speech Processing' },
      { id: '303', name: 'Audio Generation' },
    ],
  },
  { id: '4', name: '3D Generation', skills: [{ id: '401', name: 'Text to 3D' }, { id: '402', name: 'Image to 3D' }, { id: '403', name: 'Neural 3D Reconstruction' }] },
  {
    id: '5',
    name: 'Multimodal Processing',
    skills: [
      { id: '501', name: 'Image to Text' },
      { id: '502', name: 'Visual Question Answering' },
      { id: '503', name: 'Document Understanding' },
      { id: '504', name: 'Any to Any Transformation' },
    ],
  },
  {
    id: '6',
    name: 'Software Engineering',
    skills: [
      { id: '601', name: 'Code Generation' },
      { id: '602', name: 'Web Development' },
      { id: '603', name: 'Mobile Development' },
      { id: '604', name: 'API Development' },
      { id: '605', name: 'Software Testing' },
      { id: '606', name: 'Code Debugging' },
      { id: '607', name: 'Code Quality and Maintenance' },
      { id: '608', name: 'Code Documentation' },
      { id: '609', name: 'Software Architecture and Design' },
      { id: '610', name: 'Version Control and Collaboration' },
      { id: '611', name: 'Build, Packaging and Dev Tooling' },
      { id: '612', name: 'Specialized Application Development' },
    ],
  },
  {
    id: '7',
    name: 'AI/ML Engineering',
    skills: [
      { id: '701', name: 'Classical Machine Learning' },
      { id: '702', name: 'Model Training and Fine-Tuning' },
      { id: '703', name: 'Model Optimization' },
      { id: '704', name: 'Inference and Serving' },
      { id: '705', name: 'Prompt Engineering' },
      { id: '706', name: 'Retrieval-Augmented Generation' },
      { id: '707', name: 'Embeddings and Vector Search' },
      { id: '708', name: 'AI Agent Development' },
      { id: '709', name: 'Agent Orchestration' },
      { id: '710', name: 'Model and Agent Evaluation' },
      { id: '711', name: 'LLM Observability' },
      { id: '712', name: 'AI Safety and Guardrails' },
      { id: '713', name: 'Training Data Engineering' },
      { id: '714', name: 'ML Experimentation and Lifecycle' },
      { id: '715', name: 'Model Interpretability' },
      { id: '716', name: 'LLM Capabilities' },
    ],
  },
  {
    id: '8',
    name: 'Data Engineering and Analytics',
    skills: [
      { id: '801', name: 'Databases' },
      { id: '802', name: 'Data Modeling and Design' },
      { id: '803', name: 'Query Engineering' },
      { id: '804', name: 'Data Pipelines' },
      { id: '805', name: 'Data Warehousing' },
      { id: '806', name: 'Data Quality' },
      { id: '807', name: 'Data Analytics' },
      { id: '808', name: 'Business Intelligence' },
      { id: '809', name: 'Data Visualization' },
      { id: '810', name: 'Web Data Acquisition' },
    ],
  },
  {
    id: '9',
    name: 'DevOps and Cloud Infrastructure',
    skills: [
      { id: '901', name: 'Containerization' },
      { id: '902', name: 'Container Orchestration' },
      { id: '903', name: 'Infrastructure as Code' },
      { id: '904', name: 'CI/CD Pipelines' },
      { id: '905', name: 'Deployment and Release Management' },
      { id: '906', name: 'Cloud Platform Operations' },
      { id: '907', name: 'Serverless and Edge Computing' },
      { id: '908', name: 'Observability' },
      { id: '909', name: 'Site Reliability Engineering' },
      { id: '910', name: 'Cloud Networking' },
      { id: '911', name: 'GitOps' },
    ],
  },
  {
    id: '10',
    name: 'Cybersecurity',
    skills: [
      { id: '1001', name: 'Application Security' },
      { id: '1002', name: 'Offensive Security' },
      { id: '1003', name: 'Vulnerability Management' },
      { id: '1004', name: 'Threat Modeling' },
      { id: '1005', name: 'Identity and Access Management' },
      { id: '1006', name: 'Cryptography and Secrets' },
      { id: '1007', name: 'Security Operations' },
      { id: '1008', name: 'Malware Analysis and Reverse Engineering' },
    ],
  },
  {
    id: '11',
    name: 'Content, Writing and Marketing',
    skills: [
      { id: '1101', name: 'Content Writing' },
      { id: '1102', name: 'Editing and Proofreading' },
      { id: '1103', name: 'Copywriting' },
      { id: '1104', name: 'Search Engine Optimization' },
      { id: '1105', name: 'Marketing Strategy' },
      { id: '1106', name: 'Advertising' },
      { id: '1107', name: 'Social Media Marketing' },
      { id: '1108', name: 'Email Marketing' },
      { id: '1109', name: 'Branding' },
    ],
  },
  {
    id: '12',
    name: 'Business and Professional',
    skills: [
      { id: '1201', name: 'Sales and CRM' },
      { id: '1202', name: 'Finance and Accounting' },
      { id: '1203', name: 'Investment and Trading' },
      { id: '1204', name: 'Human Resources' },
      { id: '1205', name: 'Legal and Contracts' },
      { id: '1206', name: 'Customer Support and Success' },
      { id: '1207', name: 'Product Management' },
      { id: '1208', name: 'Business Strategy' },
      { id: '1209', name: 'Business Operations' },
    ],
  },
  {
    id: '13',
    name: 'Research, Knowledge and Productivity',
    skills: [
      { id: '1301', name: 'Research and Scholarship' },
      { id: '1302', name: 'Web Search' },
      { id: '1303', name: 'Market and Competitive Intelligence' },
      { id: '1304', name: 'Knowledge Management' },
      { id: '1305', name: 'Document Processing' },
      { id: '1306', name: 'Office Productivity' },
      { id: '1307', name: 'Collaboration and Communication' },
      { id: '1308', name: 'Project and Task Management' },
    ],
  },
  {
    id: '14',
    name: 'Science and Specialized Domains',
    skills: [
      { id: '1401', name: 'Life Sciences' },
      { id: '1402', name: 'Healthcare and Clinical' },
      { id: '1403', name: 'Medical Device Regulatory and Quality' },
      { id: '1404', name: 'Scientific Computing' },
      { id: '1405', name: 'Blockchain and Web3' },
      { id: '1406', name: 'Geospatial and GIS' },
      { id: '1407', name: 'Energy and Sustainability' },
    ],
  },
  {
    id: '15',
    name: 'Reasoning and Planning',
    skills: [
      { id: '1501', name: 'Logical Reasoning' },
      { id: '1502', name: 'Chain-of-Thought Structuring' },
      { id: '1503', name: 'Long-Horizon Reasoning' },
      { id: '1504', name: 'Strategic Planning' },
      { id: '1505', name: 'Hypothesis Generation' },
    ],
  },
  {
    id: '16',
    name: 'Mathematical Reasoning',
    skills: [
      { id: '1601', name: 'Pure Mathematical Operations' },
      { id: '1602', name: 'Math Word Problems' },
      { id: '1603', name: 'Geometry' },
      { id: '1604', name: 'Automated Theorem Proving' },
    ],
  },
  {
    id: '17',
    name: 'Tool Use and Automation',
    skills: [
      { id: '1701', name: 'Tool Use Planning' },
      { id: '1702', name: 'API Schema Understanding' },
      { id: '1703', name: 'Script Integration' },
      { id: '1704', name: 'Workflow Automation' },
      { id: '1705', name: 'Browser Automation' },
    ],
  },
  {
    id: '18',
    name: 'Governance, Compliance and Ethics',
    skills: [
      { id: '1801', name: 'Compliance Assessment' },
      { id: '1802', name: 'Policy Mapping' },
      { id: '1803', name: 'Risk Classification' },
      { id: '1804', name: 'Audit Trail Summarization' },
      { id: '1805', name: 'Privacy Risk Assessment' },
      { id: '1806', name: 'Content Moderation' },
      { id: '1807', name: 'Bias Mitigation' },
      { id: '1808', name: 'Responsible AI Governance' },
    ],
  },
];

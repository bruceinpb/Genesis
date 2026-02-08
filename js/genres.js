/**
 * Genesis 2 — Genre & Subgenre Taxonomy with Prose Style Rules
 * Each genre has specific AI writing rules to ensure consistent style.
 */

const GENRE_DATA = [
  {
    id: 'literary-fiction',
    label: 'Literary Fiction',
    rules: 'Write in a literary prose style. Prioritize thematic depth, complex characterization, and elegant sentence construction. Use metaphor, symbolism, and subtext. Vary sentence length dramatically. Internal monologue should be rich and introspective. Avoid genre clichés. Every sentence should carry weight. Pacing can be slow and deliberate. Focus on the human condition.',
    subgenres: [
      { id: 'literary-contemporary', label: 'Contemporary Literary', rules: 'Set in the present day. Explore modern social dynamics, identity, and relationships with nuanced prose. Realistic dialogue with subtext.' },
      { id: 'literary-experimental', label: 'Experimental', rules: 'Push narrative boundaries with unconventional structure, fragmented timelines, stream-of-consciousness, or unreliable narration. Prioritize voice and form over plot.' },
      { id: 'literary-upmarket', label: 'Upmarket/Book Club', rules: 'Blend literary prose quality with accessible, plot-driven storytelling. Appeal to both literary and commercial readers. Strong emotional resonance with universal themes.' },
      { id: 'literary-biographical', label: 'Biographical Fiction', rules: 'Base the narrative on real people and events. Blend historical fact with imagined interior life. Research-grounded prose with period-authentic detail.' }
    ]
  },
  {
    id: 'romance',
    label: 'Romance',
    rules: 'Center the love story as the main plot. Build romantic tension through meaningful interactions, emotional vulnerability, and chemistry. Include both internal longing and external obstacles. Ensure a satisfying HEA (Happily Ever After) or HFN (Happy For Now). Dialogue should crackle with tension or tenderness. Sensory detail is essential—touch, scent, warmth. Pacing should alternate between intimate moments and conflict.',
    subgenres: [
      { id: 'romance-contemporary', label: 'Contemporary Romance', rules: 'Set in the modern world. Realistic settings, modern dialogue, current social dynamics. Banter should feel natural and witty.' },
      { id: 'romance-historical', label: 'Historical Romance', rules: 'Set in a specific historical period. Use period-appropriate language, customs, and social constraints. The era itself should create romantic obstacles. Research-grounded detail without info-dumping.' },
      { id: 'romance-paranormal', label: 'Paranormal Romance', rules: 'Blend romance with supernatural elements—vampires, shifters, fae, etc. World-building supports the romance. The paranormal element should create unique romantic tension.' },
      { id: 'romance-suspense', label: 'Romantic Suspense', rules: 'Combine a love story with a suspense/thriller plot. Danger brings the couple together. Alternate between romantic scenes and suspense sequences. Both plotlines must resolve satisfyingly.' },
      { id: 'romance-fantasy', label: 'Fantasy Romance', rules: 'Romance set in a fantasy world with magic systems and world-building. The fantasy setting should create unique romantic obstacles and possibilities.' },
      { id: 'romance-regency', label: 'Regency Romance', rules: 'Set in the English Regency era (1811-1820). Witty dialogue, social propriety as obstacle, ballrooms and country estates. Austen-influenced prose with restrained passion.' },
      { id: 'romance-dark', label: 'Dark Romance', rules: 'Explore morally complex or taboo romantic dynamics. Intense emotional stakes, power dynamics, and antiheroes. Prose should be visceral and unflinching.' },
      { id: 'romance-romcom', label: 'Romantic Comedy', rules: 'Light, humorous tone with witty banter and comedic situations. Misunderstandings and awkward moments drive the plot. Fast-paced with laugh-out-loud dialogue.' }
    ]
  },
  {
    id: 'mystery',
    label: 'Mystery',
    rules: 'Structure around a central puzzle or crime to be solved. Plant clues fairly throughout. Use red herrings and misdirection. Build suspense through information control—reveal and conceal strategically. The protagonist should actively investigate. Pacing should tighten as the solution approaches. The resolution must be logical and satisfying.',
    subgenres: [
      { id: 'mystery-cozy', label: 'Cozy Mystery', rules: 'Light tone, small-town setting, amateur sleuth. No graphic violence or explicit content. Quirky supporting characters and community warmth. Often includes a hobby or profession theme (baking, bookshop, etc.).' },
      { id: 'mystery-police', label: 'Police Procedural', rules: 'Follow law enforcement investigation realistically. Accurate forensic and procedural detail. Multiple cases or subplots. Gritty, authentic dialogue. Show the toll of the job on personal life.' },
      { id: 'mystery-amateur', label: 'Amateur Sleuth', rules: 'Civilian protagonist drawn into investigation. Use their unique skills or knowledge as investigative tools. Balance the mystery with their everyday life.' },
      { id: 'mystery-noir', label: 'Noir', rules: 'Dark, cynical tone. Morally ambiguous protagonist. Urban setting with atmosphere of corruption and decay. First-person narration with hardboiled voice. Femme fatales, betrayal, and moral compromise.' },
      { id: 'mystery-hardboiled', label: 'Hard-Boiled', rules: 'Tough, world-weary detective. Spare, punchy prose with sharp dialogue. Violence is direct and consequential. Urban grit. Chandler/Hammett tradition.' },
      { id: 'mystery-locked-room', label: 'Locked Room/Impossible Crime', rules: 'Center on a seemingly impossible crime. Puzzle-focused with ingenious solutions. Fair-play cluing. Intellectual satisfaction is paramount.' }
    ]
  },
  {
    id: 'thriller',
    label: 'Thriller/Suspense',
    rules: 'Maintain relentless forward momentum and tension. High stakes—lives, nations, or sanity at risk. Short chapters and frequent cliffhangers. The protagonist is in danger, not just investigating. Use ticking clocks and escalating threats. Prose should be tight and propulsive. Cut unnecessary words. Every scene must advance the threat or deepen the stakes.',
    subgenres: [
      { id: 'thriller-psychological', label: 'Psychological Thriller', rules: 'Tension comes from the mind—unreliable narrators, gaslighting, paranoia, obsession. Interior psychology drives the plot. Reality itself may be questionable. Slow-burn dread.' },
      { id: 'thriller-legal', label: 'Legal Thriller', rules: 'Courtroom drama and legal maneuvering drive the plot. Accurate legal procedure and terminology. High-stakes trials, corrupt systems, and moral dilemmas.' },
      { id: 'thriller-medical', label: 'Medical Thriller', rules: 'Medical or scientific crisis at the center. Authentic clinical detail. Pandemics, experimental procedures, or medical conspiracies. Technical accuracy matters.' },
      { id: 'thriller-political', label: 'Political Thriller', rules: 'Government intrigue, power plays, and political conspiracy. Authentic depiction of political systems. Multiple factions with competing agendas.' },
      { id: 'thriller-espionage', label: 'Spy/Espionage', rules: 'Intelligence operations, tradecraft, and geopolitical stakes. Double agents, dead drops, and moral ambiguity. Le Carré-style complexity or Fleming-style action.' },
      { id: 'thriller-techno', label: 'Techno-Thriller', rules: 'Technology drives the plot—cyber warfare, weapons systems, AI. Detailed technical accuracy. Military or intelligence backdrop. Crichton/Clancy tradition.' },
      { id: 'thriller-domestic', label: 'Domestic Thriller', rules: 'Danger within the home or close relationships. Suburban settings hiding dark secrets. Unreliable narrators, toxic marriages, missing persons. Flynn/Hawkins tradition.' }
    ]
  },
  {
    id: 'science-fiction',
    label: 'Science Fiction',
    rules: 'Ground speculative elements in scientific plausibility or logical extrapolation. World-building should feel consistent and thought-through. Explore how technology or science changes humanity and society. Balance exposition with narrative—weave world-building into action and dialogue. Avoid info-dumps. The science fiction element should be essential to the story, not decorative.',
    subgenres: [
      { id: 'scifi-space-opera', label: 'Space Opera', rules: 'Epic scale—galactic civilizations, space battles, grand political drama. Rich world-building with multiple species and cultures. Sweeping, cinematic prose. Character drama against cosmic backdrop.' },
      { id: 'scifi-cyberpunk', label: 'Cyberpunk', rules: 'Near-future dystopia with advanced technology and social decay. Corporate power, hacking, body modification, virtual reality. Gritty urban settings. Noir-influenced prose with tech jargon.' },
      { id: 'scifi-hard', label: 'Hard Science Fiction', rules: 'Rigorous scientific accuracy drives the narrative. Real physics, biology, and engineering. Problem-solving through science. Intellectual satisfaction. Clarke/Weir tradition.' },
      { id: 'scifi-time-travel', label: 'Time Travel', rules: 'Explore temporal mechanics and paradoxes. The rules of time travel must be internally consistent. Historical detail for past settings. Emotional consequences of temporal displacement.' },
      { id: 'scifi-first-contact', label: 'First Contact', rules: 'Humanity encounters alien intelligence. Explore communication barriers, cultural difference, and existential questions. Scientific rigor in depicting alien biology and psychology.' },
      { id: 'scifi-military', label: 'Military Sci-Fi', rules: 'Military operations in a science fiction setting. Realistic combat tactics adapted to future tech. Chain of command, camaraderie, and the cost of war. Action-driven with strategic depth.' },
      { id: 'scifi-steampunk', label: 'Steampunk', rules: 'Alternate history with Victorian-era aesthetics and steam-powered technology. Rich period detail blended with fantastical invention. Adventurous tone with ornate prose.' },
      { id: 'scifi-cli-fi', label: 'Climate Fiction', rules: 'Explore climate change impacts on society. Near-future or present-day settings grappling with environmental collapse. Grounded in real science. Hopeful or cautionary.' }
    ]
  },
  {
    id: 'fantasy',
    label: 'Fantasy',
    rules: 'Build a consistent, immersive secondary world (or magical overlay on our world). Magic systems should have rules and costs. Rich sensory description of fantastical settings. Names, cultures, and languages should feel organic. Avoid modern idioms unless deliberately chosen. Balance world-building exposition with story momentum. The fantasy elements must be integral to the plot.',
    subgenres: [
      { id: 'fantasy-epic', label: 'Epic/High Fantasy', rules: 'Grand scale with world-shaking stakes. Multiple POV characters on interweaving quests. Detailed world-building with maps, histories, and magic systems. Tolkien/Jordan/Sanderson tradition. Elevated prose register.' },
      { id: 'fantasy-urban', label: 'Urban Fantasy', rules: 'Magic exists in the modern city. Blend the mundane and magical. Fast-paced, often first-person with a wry voice. Butcher/Aaronovitch tradition. Contemporary dialogue with magical elements.' },
      { id: 'fantasy-dark', label: 'Dark Fantasy', rules: 'Grim, morally grey world. Violence has real consequences. Antiheroes and moral ambiguity. Abercrombie/Hobb tradition. Unflinching prose with emotional depth.' },
      { id: 'fantasy-sword-sorcery', label: 'Sword & Sorcery', rules: 'Action-focused with warriors, rogues, and sorcerers. Personal stakes over world-shaking ones. Pulp-influenced pacing. Howard/Leiber tradition. Vivid combat and adventure.' },
      { id: 'fantasy-fairy-tale', label: 'Fairy Tale Retelling', rules: 'Reimagine classic fairy tales with fresh perspectives. Lyrical, atmospheric prose. Subvert or deepen traditional tropes. Often features feminist or revisionist angles.' },
      { id: 'fantasy-gaslamp', label: 'Gaslamp Fantasy', rules: 'Victorian or Edwardian setting with magic. Elegant prose, social intrigue, and supernatural mystery. Blends mannered society with fantastical elements.' },
      { id: 'fantasy-litrpg', label: 'LitRPG/Progression', rules: 'Character exists in a game-like system with stats, levels, and abilities. Show progression and power growth. Include system notifications and stat blocks naturally. Accessible, energetic prose.' },
      { id: 'fantasy-cozy', label: 'Cozy Fantasy', rules: 'Low stakes, warm tone, found family. Comfort reading with gentle conflict. Focus on community, small joys, and personal growth. No graphic violence. Wholesome and heartwarming.' }
    ]
  },
  {
    id: 'horror',
    label: 'Horror',
    rules: 'Build dread through atmosphere, pacing, and the unknown. Use sensory detail to create visceral unease. What is suggested or partially glimpsed is often scarier than what is shown. Establish normalcy before disrupting it. Escalate tension methodically. The horror should tap into primal fears. Characters must feel real so readers fear for them.',
    subgenres: [
      { id: 'horror-gothic', label: 'Gothic Horror', rules: 'Atmosphere of decay, isolation, and dark romance. Crumbling estates, family secrets, and supernatural dread. Ornate, brooding prose. Shelley/Brontë/du Maurier tradition.' },
      { id: 'horror-cosmic', label: 'Cosmic Horror', rules: 'Incomprehensible entities and existential dread. Human insignificance in a vast, indifferent universe. Unreliable perception. Lovecraft tradition but modernized. Building wrongness and alienation.' },
      { id: 'horror-supernatural', label: 'Supernatural Horror', rules: 'Ghosts, demons, cursed objects, and hauntings. Establish rules for the supernatural threat. Build from subtle disturbances to full manifestation. Atmosphere is paramount.' },
      { id: 'horror-psychological', label: 'Psychological Horror', rules: 'The horror comes from within—madness, obsession, trauma. Is it real or imagined? Unreliable narration and dissolving reality. Shirley Jackson tradition. Slow, suffocating dread.' },
      { id: 'horror-folk', label: 'Folk Horror', rules: 'Rural settings, ancient rituals, and pagan traditions. The land itself feels threatening. Isolation from modernity. Wicker Man/Midsommar tradition. Creeping unease beneath pastoral beauty.' },
      { id: 'horror-body', label: 'Body Horror', rules: 'Physical transformation, mutation, and bodily violation. Visceral, graphic description of bodily wrongness. Cronenberg tradition. The body as source of terror.' }
    ]
  },
  {
    id: 'historical',
    label: 'Historical Fiction',
    rules: 'Immerse the reader in a specific time period through authentic detail—language, customs, technology, social structures. Research must be thorough but worn lightly. Avoid anachronistic words, attitudes, or objects. Dialogue should feel period-appropriate without being impenetrable. The historical setting should drive the plot, not merely decorate it.',
    subgenres: [
      { id: 'historical-ancient', label: 'Ancient World', rules: 'Set in antiquity—Egypt, Rome, Greece, Mesopotamia. Vivid recreation of ancient cultures. Political intrigue, warfare, and daily life. Balance historical accuracy with narrative accessibility.' },
      { id: 'historical-medieval', label: 'Medieval', rules: 'Set in the Middle Ages. Feudal politics, religious influence, and social hierarchy. Authentic material culture—food, clothing, architecture. Avoid modern sensibilities while remaining readable.' },
      { id: 'historical-tudor', label: 'Tudor/Elizabethan', rules: 'Set in 16th-century England. Court intrigue, religious upheaval, and political danger. Rich period language influenced by Shakespeare. Mantel/Gregory tradition.' },
      { id: 'historical-victorian', label: 'Victorian', rules: 'Set in the 19th century. Social stratification, industrialization, and empire. Detailed period atmosphere. Can range from Dickensian social realism to sensation novels.' },
      { id: 'historical-wwii', label: 'World War II', rules: 'Set during 1939-1945. Authentic military, civilian, or resistance perspectives. Emotional weight of the conflict. Research-grounded with attention to geography and chronology.' },
      { id: 'historical-regency', label: 'Regency Era', rules: 'Set in early 19th-century England. Mannered society, social seasons, and Napoleonic backdrop. Witty dialogue and social observation. Austen/Heyer tradition.' }
    ]
  },
  {
    id: 'crime',
    label: 'Crime/Detective',
    rules: 'Focus on crime and its consequences from various perspectives—detective, criminal, victim, or bystander. Authentic procedural detail when relevant. Explore the moral complexities of crime and justice. Strong sense of place. Gritty, realistic dialogue. The crime should reveal something about human nature or society.',
    subgenres: [
      { id: 'crime-detective', label: 'Private Detective', rules: 'PI protagonist navigating both the case and their own troubled life. Streets-level investigation. Personal code of honor in a corrupt world. Chandler tradition.' },
      { id: 'crime-heist', label: 'Heist/Caper', rules: 'Planning and executing an elaborate theft or con. Ensemble cast with specialized skills. Clever plotting with twists and double-crosses. Can be serious or light-hearted.' },
      { id: 'crime-true-crime', label: 'True Crime Fiction', rules: 'Fictionalized account of real crimes. Journalistic attention to detail. Multiple perspectives. Capote tradition. Ethical sensitivity to real victims.' },
      { id: 'crime-organized', label: 'Organized Crime', rules: 'Mafia, cartels, or criminal organizations. Power structures, loyalty, and betrayal. Violent but with code and ritual. Puzo/Ellroy tradition.' }
    ]
  },
  {
    id: 'western',
    label: 'Western',
    rules: 'Set in the American frontier (typically 1860s-1900s). Vast landscapes described with cinematic sweep. Themes of justice, survival, and moral codes. Spare, muscular prose. Authentic period dialect without overdoing it. Horses, gunfights, and frontier towns rendered with sensory precision. McMurtry/Portis/McCarthy tradition.',
    subgenres: [
      { id: 'western-traditional', label: 'Traditional Western', rules: 'Classic cowboys, outlaws, and lawmen. Clear moral framework. Action-driven with showdowns and chases. Louis L\'Amour tradition.' },
      { id: 'western-revisionist', label: 'Revisionist Western', rules: 'Subvert traditional Western myths. Include marginalized perspectives—Indigenous, women, people of color. Moral ambiguity. Blood Meridian/Deadwood tradition.' },
      { id: 'western-contemporary', label: 'Neo-Western', rules: 'Western themes in modern settings. Contemporary Southwest or rural America. Drug cartels, border conflicts, ranching life. No Country for Old Men tradition.' }
    ]
  },
  {
    id: 'young-adult',
    label: 'Young Adult (YA)',
    rules: 'Protagonist aged 14-18 navigating identity, first experiences, and coming of age. Voice must feel authentically teen—not childish, not adult. Immediate, present-tense energy (first person common). Emotional intensity is high and valid. Romance is sweet to moderate. Stakes feel world-ending to the protagonist. Fast pacing with short chapters.',
    subgenres: [
      { id: 'ya-fantasy', label: 'YA Fantasy', rules: 'Teen protagonist in a fantasy world. Coming-of-age woven with magical destiny. World-building should be accessible. Chosen one narratives, magical academies, or epic quests.' },
      { id: 'ya-romance', label: 'YA Romance', rules: 'First love as the central story. Butterflies, uncertainty, and emotional intensity. Clean to moderate heat level. Authentic teen relationship dynamics.' },
      { id: 'ya-dystopian', label: 'YA Dystopian', rules: 'Teen rebels against oppressive society. Clear social commentary accessible to young readers. Action-driven with moral choices. Hunger Games/Divergent tradition.' },
      { id: 'ya-contemporary', label: 'YA Contemporary', rules: 'Realistic modern teen life. School, family, identity, mental health, friendship. Authentic voice and current references. John Green/Angie Thomas tradition.' },
      { id: 'ya-horror', label: 'YA Horror', rules: 'Age-appropriate scares with teen protagonists. Coming-of-age fears externalized as horror. Can be supernatural or psychological. R.L. Stine to Stephanie Perkins range.' }
    ]
  },
  {
    id: 'childrens',
    label: "Children's Fiction",
    rules: 'CRITICAL: Write in standard prose narrative paragraphs. Do NOT write in rhyming verse, poetry, or couplets unless the subgenre specifically requires it. Use age-appropriate vocabulary and sentence length. Show, don\'t tell emotions through action and dialogue. Themes of friendship, courage, discovery, and kindness. Protagonists should be resourceful and relatable. Adults are present but kids drive the story. Keep descriptions vivid but concise. Humor is essential.',
    subgenres: [
      { id: 'childrens-picture-book', label: 'Picture Book (Ages 3-7)', rules: 'Simple, rhythmic prose (rhyming verse IS appropriate here). Repetition and patterns. Under 1,000 words. Strong visual imagery for illustration. Read-aloud quality. Each page should advance the story.' },
      { id: 'childrens-early-reader', label: 'Early Reader (Ages 5-8)', rules: 'Short sentences and simple vocabulary. Chapters of 2-5 pages. Humor and action keep readers engaged. 1,000-5,000 words total. Simple but complete story arcs. NO rhyming verse—write in normal prose.' },
      { id: 'childrens-chapter-book', label: 'Chapter Book (Ages 7-10)', rules: 'Standard prose narrative. Short chapters with cliffhangers. 5,000-15,000 words. Relatable school/family/adventure scenarios. Light humor woven throughout. NO rhyming verse—write in normal prose paragraphs.' },
      { id: 'childrens-middle-grade', label: 'Middle Grade (Ages 8-12)', rules: 'More complex plots with subplots. 20,000-50,000 words. Protagonist aged 10-13. Themes of identity, belonging, and growing independence. Can handle darker themes with hope. Harry Potter/Percy Jackson tradition.' },
      { id: 'childrens-animal-story', label: 'Animal Story', rules: 'Animals as protagonists—talking or realistic. If animals talk, maintain consistent rules. Focus on adventure, friendship, and nature. Vivid natural settings. Charlotte\'s Web/Watership Down tradition. Write in PROSE, not verse.' }
    ]
  },
  {
    id: 'womens-fiction',
    label: "Women's Fiction",
    rules: 'Center women\'s emotional journeys and life transitions. Rich interior life and relational dynamics. Can span any life stage. The protagonist\'s personal growth is the spine of the story. Relationships (not just romantic) drive the narrative. Honest portrayal of women\'s experiences. Prose should be warm, perceptive, and emotionally intelligent.',
    subgenres: [
      { id: 'womens-domestic', label: 'Domestic Fiction', rules: 'Family dynamics, marriage, motherhood, and home life. Intimate scale with emotional depth. Kitchen-table drama. Picoult/Moriarty tradition.' },
      { id: 'womens-friendship', label: 'Friendship Fiction', rules: 'Female friendships at the center. Bonds tested by life changes, secrets, or conflict. Ensemble dynamics. Steel Magnolias/Big Little Lies tradition.' },
      { id: 'womens-saga', label: 'Family Saga', rules: 'Multi-generational story tracing a family through decades. Secrets, inheritance, and legacy. Rich historical backdrop. Sweeping narrative scope.' }
    ]
  },
  {
    id: 'adventure',
    label: 'Adventure',
    rules: 'Action-driven narrative with physical challenges, exotic settings, and high stakes. Keep the pace fast with constant forward motion. Vivid, cinematic description of action sequences. The environment is often an antagonist. Resourceful protagonist who thinks on their feet. Short chapters and frequent set pieces.',
    subgenres: [
      { id: 'adventure-survival', label: 'Survival', rules: 'Character(s) stranded in hostile environment. Detailed survival techniques and natural threats. Hatchet/The Martian tradition. Problem-solving under extreme pressure.' },
      { id: 'adventure-quest', label: 'Quest/Journey', rules: 'Physical journey with a clear goal. Obstacles and discoveries along the way. The journey transforms the traveler. Indiana Jones/Treasure Island tradition.' },
      { id: 'adventure-sea', label: 'Sea/Nautical', rules: 'Set on the ocean. Sailing, naval warfare, or maritime exploration. Authentic nautical terminology. The sea as character. O\'Brian/Forester tradition.' }
    ]
  },
  {
    id: 'dystopian',
    label: 'Dystopian/Post-Apocalyptic',
    rules: 'Depict a broken or oppressive future society. World-building should feel plausible and terrifying. Social commentary drives the narrative. Contrast the dystopian world with human resilience, hope, or rebellion. Atmospheric, often bleak prose. The rules of the dystopian world must be consistent.',
    subgenres: [
      { id: 'dystopian-totalitarian', label: 'Totalitarian Dystopia', rules: 'Oppressive government controls society. Surveillance, propaganda, and thought control. Orwell/Atwood tradition. The individual vs. the system.' },
      { id: 'dystopian-post-apocalyptic', label: 'Post-Apocalyptic', rules: 'Society has collapsed. Survival in the ruins. What caused the fall matters less than its human cost. McCarthy\'s The Road tradition. Sparse, stark prose.' },
      { id: 'dystopian-tech', label: 'Techno-Dystopia', rules: 'Technology has created a nightmarish society. AI control, surveillance capitalism, or digital addiction. Black Mirror tradition. Near-future plausibility.' }
    ]
  },
  {
    id: 'magical-realism',
    label: 'Magical Realism',
    rules: 'Magic exists naturally within an otherwise realistic world. Do not explain or justify the magical elements—present them matter-of-factly. Lush, sensory prose with poetic cadence. Often rooted in specific cultural traditions. Time may be fluid. Symbolism is layered throughout. García Márquez/Allende/Murakami tradition. Literary prose quality with wonder woven into the everyday.',
    subgenres: [
      { id: 'magreal-latin', label: 'Latin American Tradition', rules: 'García Márquez/Allende/Borges tradition. Rich, baroque prose. Multi-generational stories. Political undertones. The magical reflects cultural memory and collective experience.' },
      { id: 'magreal-japanese', label: 'Japanese Tradition', rules: 'Murakami/Ogawa tradition. Subtle, understated magic. Loneliness, displacement, and quiet wonder. Clean, spare prose with surreal undercurrents.' },
      { id: 'magreal-contemporary', label: 'Contemporary Magical Realism', rules: 'Modern settings with magical elements reflecting current social themes. Identity, immigration, grief given magical expression. Accessible literary prose.' }
    ]
  },
  {
    id: 'contemporary',
    label: 'Contemporary Fiction',
    rules: 'Set in the present day with realistic characters and situations. Focus on relatable human experiences. Prose should feel current and authentic. Dialogue reflects modern speech patterns. Social media, technology, and current events can feature naturally. Character-driven with attention to emotional truth.',
    subgenres: [
      { id: 'contemp-slice-of-life', label: 'Slice of Life', rules: 'Everyday life elevated through keen observation. Small moments carry big meaning. Quiet prose that finds beauty in the ordinary. No dramatic plot required—character and voice carry the narrative.' },
      { id: 'contemp-social', label: 'Social Novel', rules: 'Engage directly with contemporary social issues—race, class, gender, politics. Multiple perspectives and viewpoints. Franzen/Smith tradition. Ambitious scope with personal stories.' },
      { id: 'contemp-coming-of-age', label: 'Coming of Age', rules: 'Adult protagonist navigating a pivotal life transition. Loss of innocence, identity formation, or major life change. Emotionally honest. Catcher in the Rye/Normal People tradition.' }
    ]
  },
  {
    id: 'humor',
    label: 'Humor/Satire',
    rules: 'Comedy is in the prose itself, not just situations. Witty narrative voice with comic timing in sentence structure. Exaggeration, irony, and absurdity are tools. Satirical targets should be clear. Even in comedy, characters need emotional stakes. Dialogue should sparkle. Pacing is crucial—don\'t kill jokes by over-explaining.',
    subgenres: [
      { id: 'humor-satire', label: 'Satire', rules: 'Use humor to critique society, politics, or human nature. Sharp, pointed wit. Vonnegut/Heller/Swift tradition. The humor serves a deeper purpose.' },
      { id: 'humor-absurdist', label: 'Absurdist', rules: 'Logic breaks down. Surreal situations played straight. Kafka/Catch-22 tradition. The absurdity reveals deeper truths about the human condition.' },
      { id: 'humor-comic-novel', label: 'Comic Novel', rules: 'Humor as the primary reading pleasure. Farce, wit, and comic set-pieces. Wodehouse/Pratchett/Toole tradition. Infectious joy in language.' }
    ]
  },
  {
    id: 'war',
    label: 'War/Military',
    rules: 'Authentic depiction of combat, military life, and the human cost of war. Research-grounded detail—weapons, tactics, ranks, daily routines. Show both heroism and horror without glorifying or sanitizing. Brotherhood, sacrifice, and moral injury as themes. Varied prose rhythm—explosive action and quiet aftermath.',
    subgenres: [
      { id: 'war-historical', label: 'Historical War', rules: 'Set during a specific real conflict. Meticulous period and military accuracy. Balance tactical detail with human stories. All Quiet on the Western Front tradition.' },
      { id: 'war-contemporary', label: 'Contemporary Military', rules: 'Modern warfare—Iraq, Afghanistan, counter-terrorism. Authentic military culture and technology. PTSD and homecoming challenges. Redeployment/Klay tradition.' },
      { id: 'war-resistance', label: 'Resistance/Occupation', rules: 'Civilian perspective during wartime. Occupation, resistance, and moral choices under duress. Intimate scale against epic backdrop.' }
    ]
  },
  {
    id: 'erotica',
    label: 'Erotica',
    rules: 'Sexual content is central to the story and character development, not merely decorative. Explicit but well-written—avoid clinical terms and purple prose equally. Consent is clear. Emotional connection enhances physical scenes. Sensory detail is paramount. Characters should be fully realized, not just bodies. Pacing alternates between tension, buildup, and release.',
    subgenres: [
      { id: 'erotica-contemporary', label: 'Contemporary Erotica', rules: 'Modern realistic settings. Explore desire, power dynamics, and intimacy in current social contexts. Character-driven with explicit content.' },
      { id: 'erotica-historical', label: 'Historical Erotica', rules: 'Period settings with explicit content. Social constraints create erotic tension. Authentic historical detail enhances the forbidden nature of encounters.' },
      { id: 'erotica-paranormal', label: 'Paranormal Erotica', rules: 'Supernatural beings and scenarios heighten the erotic elements. Fantasy fulfillment through magical or otherworldly encounters.' }
    ]
  }
];

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.GENRE_DATA = GENRE_DATA;
}

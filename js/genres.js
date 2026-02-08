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
  },
  {
    id: 'biography-memoir',
    label: 'Biography & Memoir',
    rules: 'Write in compelling narrative prose that reads like a novel while remaining factually grounded. Bring real people to life through vivid scene-setting, authentic dialogue (reconstructed from research), and rich sensory detail. Show the subject\'s inner world through documented actions, letters, interviews, and historical context. Balance factual accuracy with storytelling momentum. Use dramatic structure—rising action, turning points, and resolution. The prose should be engaging and literary, not encyclopedic or dry. Every chapter should read like a story, not a Wikipedia article.',
    subgenres: [
      { id: 'bio-historical', label: 'Historical Biography', rules: 'Biography of a historical figure set against their era. Extensive period detail—politics, culture, daily life of the time. Immerse the reader in the subject\'s world. Chernow/McCullough/Isaacson tradition. Research must be meticulous. Weave historical events into the personal narrative.' },
      { id: 'bio-political', label: 'Political Biography', rules: 'Focus on political figures and their exercise of power. Show the machinery of politics—campaigns, alliances, betrayals, policy battles. Caro tradition. Balance the public figure with the private person. Political context must be accessible to general readers.' },
      { id: 'bio-celebrity', label: 'Celebrity/Entertainment Biography', rules: 'Biography of artists, musicians, actors, or cultural icons. Capture the creative process and public persona vs. private reality. Show the era\'s cultural landscape. Behind-the-scenes authenticity. The subject\'s art/work should come alive on the page.' },
      { id: 'bio-military', label: 'Military Biography', rules: 'Biography of military leaders or war heroes. Authentic military detail—strategy, combat, chain of command. Show both battlefield courage and human vulnerability. The fog of war rendered vividly. Ambrose/Atkinson tradition.' },
      { id: 'bio-sports', label: 'Sports Biography', rules: 'Biography of athletes and sports figures. Capture the physicality and drama of competition. Training, sacrifice, triumph, and failure. The sport itself must come alive through vivid play-by-play prose. Show the person behind the athlete.' },
      { id: 'bio-memoir', label: 'Memoir', rules: 'First-person narrative of the author\'s own life experiences. Focus on theme rather than chronological completeness. Emotional honesty and vulnerability are paramount. Specific sensory memories bring scenes to life. Reflection and meaning-making distinguish memoir from autobiography. Karr/Didion/Knausgaard tradition.' },
      { id: 'bio-autobiography', label: 'Autobiography', rules: 'Comprehensive first-person life narrative, typically chronological. The author\'s authentic voice is everything. Balance major life events with intimate personal moments. Self-awareness without excessive self-congratulation. Historical context grounds the personal story.' },
      { id: 'bio-true-adventure', label: 'True Adventure/Exploration', rules: 'Biography or memoir centered on extraordinary journeys, expeditions, or survival. Cinematic, propulsive prose. The environment is a character—mountains, oceans, polar ice. Physical danger creates narrative tension. Krakauer/Lansing tradition.' }
    ]
  },
  {
    id: 'christian-fiction',
    label: 'Christian/Inspirational Fiction',
    rules: 'Faith is woven naturally into the narrative without being preachy or didactic. Characters struggle authentically with doubt, temptation, and spiritual growth. Show faith through actions and choices, not sermons. Clean content—no explicit sexual content, minimal profanity. Themes of redemption, grace, forgiveness, and hope. The story must work as compelling fiction first; the inspirational element should feel organic, not forced.',
    subgenres: [
      { id: 'christian-romance', label: 'Christian Romance', rules: 'Love story centered on faith-compatible values. Clean romance with emotional depth—longing, tenderness, commitment. Physical intimacy is implied or behind closed doors. Couples often grow in faith together. Karen Kingsbury/Francine Rivers tradition.' },
      { id: 'christian-historical', label: 'Christian Historical', rules: 'Historical fiction with faith themes. Authentic period detail and language. Characters navigate historical challenges through faith. Biblical-era, colonial, Civil War, and WWII settings are popular. Thoene/Austin tradition.' },
      { id: 'christian-suspense', label: 'Christian Suspense/Thriller', rules: 'Suspenseful plot with spiritual warfare or faith-tested-by-danger themes. Clean but intense—violence is present but not gratuitous. The protagonist\'s faith is challenged by the crisis. Dee Henderson/Terri Blackstock tradition.' },
      { id: 'christian-fantasy', label: 'Christian Fantasy/Allegory', rules: 'Fantasy or speculative fiction with Christian themes and allegory. Spiritual truths embedded in imaginative world-building. C.S. Lewis/Tolkien tradition. Good vs. evil with theological resonance. Magic may be reframed as spiritual gifts or divine power.' },
      { id: 'christian-biblical', label: 'Biblical Fiction', rules: 'Fictionalized narratives of Biblical events and characters. Bring ancient settings to life with rich sensory detail. Imagine the interior lives of figures like Moses, David, Mary Magdalene, or Paul. Faithful to scripture while filling gaps with plausible fiction. Extensive historical and archaeological research.' },
      { id: 'christian-amish', label: 'Amish Fiction', rules: 'Set in Amish communities with authentic cultural detail—plain dress, Pennsylvania Dutch phrases, farming life, Ordnung rules. Themes of community vs. individual desire, forgiveness, and simple living. Often romance-centered. Beverly Lewis tradition.' }
    ]
  },
  {
    id: 'lgbtq-fiction',
    label: 'LGBTQ+ Fiction',
    rules: 'Center LGBTQ+ characters and experiences authentically. Identity, coming out, found family, and self-acceptance are common themes but not required—queer characters can simply exist in any genre. Avoid stereotypes and tragic-only narratives. Show the full range of queer experience—joy, love, community, and ordinary life alongside struggle. Sensitivity to intersectional identities. The prose should reflect the character\'s authentic voice and worldview.',
    subgenres: [
      { id: 'lgbtq-romance-mm', label: 'M/M Romance', rules: 'Male/male love story. Authentic emotional connection between male characters. Range from sweet to explicit. Avoid fetishizing—write fully realized people. Strong character voice and chemistry.' },
      { id: 'lgbtq-romance-ff', label: 'F/F Romance (Sapphic)', rules: 'Female/female love story. Authentic sapphic experience. Can range from sweet to steamy. Avoid male-gaze framing. Center women\'s emotional and physical experiences. Miller/Waters tradition.' },
      { id: 'lgbtq-literary', label: 'Queer Literary Fiction', rules: 'Literary prose exploring LGBTQ+ identity, culture, and experience with depth and nuance. Complex characterization and thematic ambition. Baldwin/Cunningham/Winterson tradition. Identity as one facet of a rich human story.' },
      { id: 'lgbtq-ya', label: 'LGBTQ+ Young Adult', rules: 'Teen protagonists navigating identity and first love. Hopeful, affirming tone. Coming-out stories or narratives where being queer is simply part of life. Age-appropriate content. Albertalli/Thomas tradition.' },
      { id: 'lgbtq-fantasy-scifi', label: 'Queer Speculative Fiction', rules: 'Fantasy or science fiction with LGBTQ+ protagonists and themes. Imagined worlds that explore gender and sexuality in new ways. Diverse relationship structures. Jemisin/Leckie/Solomon tradition.' }
    ]
  },
  {
    id: 'paranormal',
    label: 'Paranormal Fiction',
    rules: 'Supernatural elements are central—ghosts, psychics, vampires, shapeshifters, angels, demons, or other entities. Establish consistent rules for how the paranormal works in your world. Balance the supernatural with grounded human emotion. The paranormal elements should drive both plot and character development. Atmosphere and mood are essential—create a sense of the uncanny.',
    subgenres: [
      { id: 'paranormal-romance', label: 'Paranormal Romance', rules: 'Love story between human and supernatural being, or between supernatural beings. The paranormal nature creates unique romantic tension and obstacles. Fated mates, forbidden love, and supernatural bonding tropes. Ward/Feehan/Singh tradition.' },
      { id: 'paranormal-mystery', label: 'Paranormal Mystery', rules: 'Mystery or detective story with supernatural elements. Psychic detectives, ghost witnesses, or magical forensics. The paranormal ability both helps and complicates the investigation. Harris/Harrison tradition.' },
      { id: 'paranormal-urban', label: 'Paranormal Urban', rules: 'Supernatural beings and events in modern city settings. Hidden supernatural communities coexisting with mundane world. Fast-paced with action and attitude. Can overlap with urban fantasy but focuses more on the paranormal elements than world-building.' },
      { id: 'paranormal-ghost', label: 'Ghost Story', rules: 'Ghosts and hauntings as central element. Can be atmospheric and literary or action-oriented. The ghost\'s unfinished business drives the plot. Historical layers—the past bleeding into the present. Straub/Hill tradition.' },
      { id: 'paranormal-womens', label: "Paranormal Women's Fiction", rules: 'Women over 40 discovering supernatural abilities or entering paranormal worlds. Themes of reinvention, empowerment, and second chances. Humor and heart alongside the supernatural. Growing genre with dedicated readership.' }
    ]
  },
  {
    id: 'african-american',
    label: 'African American Fiction',
    rules: 'Center Black characters and experiences authentically. Rich cultural specificity—family traditions, community bonds, cultural touchstones, and the full spectrum of Black life. Prose should reflect authentic voice and vernacular without caricature. Themes can range from historical struggle to contemporary joy, from literary introspection to commercial entertainment. Avoid monolithic portrayals—show diversity within the community. Morrison/Butler/Whitehead tradition.',
    subgenres: [
      { id: 'aa-literary', label: 'African American Literary', rules: 'Literary fiction exploring the Black experience with depth, nuance, and prose mastery. Themes of identity, history, family, and systemic injustice rendered with artistic ambition. Morrison/Ellison/Baldwin/Ward tradition. Language itself is a tool of cultural expression.' },
      { id: 'aa-romance', label: 'African American Romance', rules: 'Love stories centering Black couples. Authentic cultural context—family dynamics, community expectations, cultural traditions. Range from sweet to steamy. Beverly Jenkins/Alyssa Cole tradition.' },
      { id: 'aa-urban', label: 'Urban Fiction/Street Lit', rules: 'Gritty, realistic stories of urban life. Drug culture, street politics, survival, and loyalty. Raw, unflinching prose with authentic street vernacular. Sister Souljah/K\'wan tradition. Fast-paced with high stakes.' },
      { id: 'aa-historical', label: 'African American Historical', rules: 'Historical fiction exploring Black history—slavery, Reconstruction, Harlem Renaissance, Civil Rights, Great Migration, and beyond. Extensive research grounds the narrative. Honor the weight of history while telling compelling individual stories. Haley/Jones/Gyasi tradition.' },
      { id: 'aa-christian', label: 'African American Christian', rules: 'Faith-centered fiction with Black characters and church culture. The Black church as community anchor. Themes of faith, family, and perseverance. Clean content with spiritual depth. ReShonda Tate Billingsley tradition.' }
    ]
  },
  {
    id: 'true-crime',
    label: 'True Crime',
    rules: 'Narrative nonfiction about real crimes. Tell the story with novelistic techniques—scene-setting, dialogue reconstruction, character development—while maintaining factual integrity. Build suspense even when the outcome is known. Show the human cost of crime—victims, perpetrators, investigators, and communities. Ethical sensitivity toward victims and their families. Thorough research from court records, interviews, and primary sources. Capote/Rule/Larson tradition.',
    subgenres: [
      { id: 'truecrime-serial', label: 'Serial Killer', rules: 'Investigation and psychology of serial murderers. Build dread through pattern recognition. Profile the killer\'s psychology without glorifying. Show the detective work and forensic breakthroughs. Douglas/Olsen tradition.' },
      { id: 'truecrime-investigation', label: 'Criminal Investigation', rules: 'Focus on the investigative process—detectives, forensics, legal proceedings. Procedural detail rendered as compelling narrative. The investigation itself is the story. Cold cases and wrongful convictions are popular subthemes.' },
      { id: 'truecrime-white-collar', label: 'White Collar Crime', rules: 'Financial fraud, corporate crime, scams, and con artists. Make complex financial schemes accessible and dramatic. The charm of the con artist vs. the devastation of victims. Carreyrou/Kolhatkar tradition.' },
      { id: 'truecrime-memoir', label: 'True Crime Memoir', rules: 'First-person account of experiencing or investigating crime. Personal stake raises emotional intensity. The author\'s journey of understanding parallels the reader\'s. Memoir techniques blend with investigative reporting.' }
    ]
  },
  {
    id: 'narrative-nonfiction',
    label: 'Narrative Nonfiction',
    rules: 'Tell true stories using fiction techniques—scene construction, dialogue, character development, narrative arc, and vivid prose. The facts are sacred but the storytelling should be compelling. Extensive research underpins every scene. Show, don\'t tell—let events and details convey meaning rather than editorializing. Immersive, transporting prose that makes the reader forget they\'re reading nonfiction.',
    subgenres: [
      { id: 'narrnf-history', label: 'Narrative History', rules: 'Historical events told as gripping stories. Bring eras alive through individual experiences and sensory detail. McCullough/Ambrose/Larson tradition. The sweep of history through intimate human stories.' },
      { id: 'narrnf-science', label: 'Science/Nature Writing', rules: 'Scientific discoveries, natural phenomena, or environmental stories told with literary prose. Make complex science accessible and wondrous. Sacks/Mukherjee/Kolbert tradition. The natural world as source of narrative drama.' },
      { id: 'narrnf-journalism', label: 'Literary Journalism', rules: 'Long-form journalism with literary ambition. Deep reporting rendered as immersive narrative. New Journalism tradition—Wolfe/Didion/Talese. Scene-by-scene construction with full characterization.' },
      { id: 'narrnf-travel', label: 'Travel Writing', rules: 'Places and journeys rendered with vivid, evocative prose. Cultural observation, personal reflection, and sensory immersion. Theroux/Chatwin/Bryson tradition. The destination should come alive for the armchair traveler.' },
      { id: 'narrnf-essay', label: 'Personal Essay/Creative Nonfiction', rules: 'Reflective, literary essays exploring ideas through personal experience. Voice-driven prose with intellectual depth. Montaigne/Didion/Rankine tradition. The essay as art form—intimate, probing, and beautifully crafted.' }
    ]
  },
  {
    id: 'new-adult',
    label: 'New Adult',
    rules: 'Protagonist aged 18-25 navigating the transition to adulthood—college, first jobs, new independence, serious relationships, and identity formation. More mature content than YA—explicit romance, heavier themes, adult consequences. Voice should feel authentically young adult without being teen. The stakes of "firsts"—first real love, first heartbreak, first major failure. Fast-paced with high emotional intensity.',
    subgenres: [
      { id: 'na-romance', label: 'New Adult Romance', rules: 'College-age or early-twenties romance. First serious relationships, intense chemistry, and emotional growth. Can be steamy or sweet. Campus settings, first apartments, found friend groups. The intensity of young love rendered vividly.' },
      { id: 'na-fantasy', label: 'New Adult Fantasy', rules: 'Fantasy with protagonists in the 18-25 range. Magical academies, coming-into-power narratives. More complex world-building and darker themes than YA fantasy. Maas/Bardugo tradition.' },
      { id: 'na-contemporary', label: 'New Adult Contemporary', rules: 'Realistic fiction about young adults navigating post-high-school life. College pressures, early career struggles, evolving family dynamics. Mental health and identity exploration. Raw, honest voice.' },
      { id: 'na-dark', label: 'New Adult Dark/Bully Romance', rules: 'Intense, edgy romance with morally complex dynamics. Power imbalances, enemies-to-lovers, dark academia settings. Explicit content with emotional depth. Anti-heroes and complicated heroines.' }
    ]
  },
  {
    id: 'sports-fiction',
    label: 'Sports Fiction',
    rules: 'Athletics and competition drive the narrative. Capture the physicality, strategy, and emotion of sport through vivid, kinetic prose. Training montages, game-day tension, and locker-room camaraderie. Show the sacrifice and dedication behind athletic achievement. Sports should be rendered with enough authentic detail to satisfy fans but enough story to engage non-fans. The sport is the backdrop for human drama—ambition, rivalry, teamwork, and redemption.',
    subgenres: [
      { id: 'sports-baseball', label: 'Baseball Fiction', rules: 'America\'s pastime as story engine. The rhythm of the season, the crack of the bat, the tension of a full count. Nostalgia and tradition. Malamud/Kinsella tradition. Baseball\'s mythology and metaphor.' },
      { id: 'sports-football', label: 'Football Fiction', rules: 'Gridiron drama—Friday night lights to professional leagues. Team dynamics, coaching strategy, and the violence of the game. Small-town identity, college recruitment, and NFL pressure. Bissinger tradition.' },
      { id: 'sports-boxing-mma', label: 'Boxing/Fighting Fiction', rules: 'The primal drama of one-on-one combat. Training discipline, weight cutting, and the fight game\'s dark side. Poverty-to-glory narratives. The ring as metaphor for life\'s struggles. Rocky/Creed tradition in fiction form.' },
      { id: 'sports-romance', label: 'Sports Romance', rules: 'Romance centered on athletes—hockey players, football stars, baseball heartthrobs. Behind-the-scenes team dynamics meet love story. Balancing career ambition with relationship. The athlete\'s body and discipline as romantic elements. Trending genre on all platforms.' }
    ]
  },
  {
    id: 'poetry',
    label: 'Poetry',
    rules: 'Every word must earn its place. Compress meaning into the most powerful possible language. Use line breaks, white space, and rhythm as structural tools. Image and metaphor carry emotional weight. Sound matters—assonance, consonance, alliteration, and internal rhyme create music. Show emotional truth through specific, concrete imagery rather than abstract statements. Read your work aloud—the ear should be as satisfied as the eye.',
    subgenres: [
      { id: 'poetry-free-verse', label: 'Free Verse', rules: 'No fixed meter or rhyme scheme. Line breaks and rhythm create organic structure. Each poem finds its own form. Image-driven with precise language. The dominant mode of contemporary poetry.' },
      { id: 'poetry-formal', label: 'Formal/Traditional', rules: 'Structured forms—sonnets, villanelles, sestinas, ghazals, pantoums. Meter and rhyme scheme are integral. The constraint of form generates creative energy. Mastery of prosody required.' },
      { id: 'poetry-narrative', label: 'Narrative Poetry', rules: 'Story told in verse. Character, plot, and setting rendered poetically. Epic poems, verse novels, and ballads. Homer to Carson tradition. Pacing must serve both story and lyric.' },
      { id: 'poetry-spoken-word', label: 'Spoken Word/Performance', rules: 'Written for oral performance. Rhythm, repetition, and rhetorical power. Direct emotional impact. Political and personal themes. The page version should convey the energy of live delivery.' },
      { id: 'poetry-prose-poetry', label: 'Prose Poetry', rules: 'Poetry written in paragraph form without line breaks. Lyric intensity in prose shape. Dream logic, compression, and image-density. Baudelaire/Simic tradition. The boundary between prose and poetry is the subject itself.' }
    ]
  }
];

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.GENRE_DATA = GENRE_DATA;
}

'use strict';
const path    = require('path');
const express = require('express');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.use(require('./server/routes/meta'));
app.use(require('./server/routes/ai'));
app.use(require('./server/routes/dev'));
app.use(require('./server/routes/game'));
app.use(require('./server/routes/inventory'));
app.use(require('./server/routes/combat'));
app.use(require('./server/routes/npc'));
app.use(require('./server/routes/event'));
app.use(require('./server/routes/dialogue'));
app.use(require('./server/routes/scavenge'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`\n  ⚔️  Dungeon RPG: http://localhost:${PORT}\n`));

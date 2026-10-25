# Lilai

Meetups and who is coming. Lilai keeps the events in its own database and publishes them to public Google calendars, so anyone can subscribe from their own calendar app. People RSVP with a typed name; no accounts.

## Features

- **Events made in Lilai**: one-off or repeating, with a seat limit, links, and an optional "I approve each person" mode
- **A management page per event**, reached by its own link: edit, cancel, accept or decline requests, share with co-hosts
- **Published Google calendars**: every change is copied to the calendar's read-only Google copy
- **Calendar keys**: a restricted calendar (TSA) takes a key link to add events to
- **Live attendance** over WebSocket, a 14-day date rail, and an installable PWA
- Bank-transfer donations, and a queue that books KU Leuven sports courts when the booking window opens

## Technology Stack

- **Frontend**: HTML, CSS and vanilla JavaScript, no build step
- **Backend**: Node.js, Express, WebSocket (`ws`)
- **Storage**: PostgreSQL
- **Calendars**: Google Calendar API (service account), write-only

## Project Structure

```
lilai/
├── public/                 # Frontend assets
│   ├── index.html         # Main HTML file
│   ├── app.js            # Frontend JavaScript
│   └── styles.css        # CSS styling
├── server/               # Backend server
│   └── app.js           # Express.js server
├── config/              # Configuration files

├── data/                # Data storage (auto-generated)
│   ├── events.json      # Events data
│   └── rsvps.json       # RSVP responses
├── package.json         # Node.js dependencies
├── .env.example         # Environment variables template
└── README.md           # Project documentation
```

## Quick Start

### Prerequisites

- Node.js (version 14 or higher)
- npm or yarn package manager

### Installation

1. **Clone or download the project** (already done if you're reading this)

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the server**:
   ```bash
   npm start
   ```

4. **Open your browser** and navigate to:
   ```
   http://localhost:3000
   ```

### Development Mode

For development with auto-restart:
```bash
npm run dev
```

## Google Calendar Setup

Lilai publishes each calendar in `config/app.json` to Google; it never reads events back once it has taken a calendar over.

1. Create a Google Cloud service account with the Calendar API enabled and download its JSON key.
2. Set the key as `GOOGLE_SERVICE_ACCOUNT_JSON` (the JSON itself or base64 of it).
3. Share each calendar with the service account's email, "Make changes to events". The server logs the address at startup.
4. List the calendars in `config/app.json` by their embed URL (`calendars[]`, in shape order). Mark one `"restricted": true` to require a calendar key to add events to it, and mint a key with `node scripts/calendar-link.js <calendar>`.
5. Start the server. Each calendar is imported once from Google; after that, make the Google calendars read-only for everyone but the service account.

Without the key, events still work in Lilai and reach Google once it is set. See `CLAUDE.md` for the details.

## API Endpoints

The application provides RESTful API endpoints:

### Events
- `GET /api/events` - Get all events
- `GET /api/events/:id` - Get specific event
- `POST /api/events` - Create new event

### RSVPs
- `POST /api/rsvp` - Submit RSVP
- `GET /api/attendance-summary` - Get attendance summary for all events
- `GET /api/attendance-summary/:eventId` - Get attendance for specific event

### Health
- `GET /api/health` - Health check endpoint

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Key configuration options:
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production)
- `GOOGLE_CALENDAR_API_KEY` - For advanced calendar integration


### Sample Events

The app comes with sample events pre-loaded. These will be replaced when you integrate your Google Calendar or add your own events via the API.

## Usage

### For Event Hosts

1. **Set up your calendar**: Follow the Google Calendar setup guide above
2. **Share the app URL** with your attendees
3. **Monitor RSVPs**: Check the attendance summary section for real-time updates
4. **Export data**: RSVP data is stored in `data/rsvps.json` for further processing

### For Attendees

1. **View events**: Browse upcoming events in the calendar and event list
2. **RSVP to events**: Click the RSVP button on any event
3. **Choose your response**: Select Yes, No, or Maybe
4. **Add your details**: Provide your name
5. **Add comments**: Include any special requirements or notes

## Deployment

### Local Production

1. Set `NODE_ENV=production` in your `.env` file
2. Run `npm start`

### Cloud Deployment

The app is ready for deployment to platforms like:
- Heroku
- Railway
- Render
- DigitalOcean App Platform
- AWS Elastic Beanstalk

Key considerations for production:
- Set up proper environment variables
- Configure HTTPS
- Set up process monitoring
- Consider database migration for scale

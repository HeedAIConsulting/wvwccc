const {
  Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel,
  BorderStyle, ExternalHyperlink, PageBreak, LevelFormat
} = require("docx");
const fs = require("fs");

const FOREST = "1B4332";
const GOLD = "9A7B00";
const GREY = "555555";

// ---- helpers -------------------------------------------------------------
function rule(color = FOREST, size = 8) {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size, color, space: 1 } },
    spacing: { after: 160 },
    children: [new TextRun({ text: "" })],
  });
}

function meta(label, value) {
  return new Paragraph({
    spacing: { after: 40 },
    children: [
      new TextRun({ text: label + "  ", bold: true, color: FOREST }),
      new TextRun({ text: value }),
    ],
  });
}

function body(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 160, line: 276 },
    children: [new TextRun({ text, ...opts })],
  });
}

// body paragraph that may contain mixed runs
function rich(children, after = 160) {
  return new Paragraph({ spacing: { after, line: 276 }, children });
}

function bullet(children) {
  const kids = Array.isArray(children) ? children : [new TextRun(children)];
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { after: 60, line: 276 },
    children: kids,
  });
}

function emailHeading(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 80, after: 80 },
    children: [new TextRun({ text })],
  });
}

function sendNote(text) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, italics: true, color: GREY, size: 20 })],
  });
}

function sig(lines) {
  return lines.map((l, i) =>
    new Paragraph({
      spacing: { after: i === lines.length - 1 ? 200 : 20 },
      children: [new TextRun({ text: l, bold: i === 0 })],
    })
  );
}

const url = () =>
  new ExternalHyperlink({
    link: "https://www.woodlandhillscc.net",
    children: [new TextRun({ text: "https://www.woodlandhillscc.net", style: "Hyperlink", bold: true })],
  });

// ---- document ------------------------------------------------------------
const doc = new Document({
  creator: "Heed AI Solutions",
  title: "WVWCCC Website Launch — Member Email Series",
  styles: {
    default: { document: { run: { font: "Calibri", size: 22 } } },
    paragraphStyles: [
      {
        id: "Title", name: "Title", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 40, bold: true, color: FOREST, font: "Calibri" },
        paragraph: { spacing: { after: 60 }, outlineLevel: 0 },
      },
      {
        id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 30, bold: true, color: FOREST, font: "Calibri" },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 540, hanging: 260 } } },
        }],
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    children: [
      // ---- Cover / intro ----
      new Paragraph({ style: "Title", children: [new TextRun("Website Launch Email Series")] }),
      new Paragraph({
        spacing: { after: 40 },
        children: [new TextRun({ text: "West Valley Warner Center Chamber of Commerce", bold: true, color: GOLD, size: 26 })],
      }),
      new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun({ text: "Three ready-to-send announcement emails for the new website going live July 1, 2026.", color: GREY, size: 22 })],
      }),
      rule(GOLD, 12),

      meta("New site address:", "https://www.woodlandhillscc.net (unchanged)"),
      meta("Launch date:", "Tuesday, July 1, 2026"),
      meta("Audience:", "All Chamber members"),
      meta("From:", "Diana [Last Name], Executive Director"),
      meta("Prepared for:", "Diana and Felicia"),
      meta("Built & managed by:", "Michael Bowers, Heed AI Solutions"),

      new Paragraph({ spacing: { before: 160, after: 60 }, children: [new TextRun({ text: "How to use this document", bold: true, color: FOREST })] }),
      bullet("Send Email 1 about a week before launch, Email 2 the day before, and Email 3 on launch morning."),
      bullet([new TextRun("Replace the bracketed placeholders ("), new TextRun({ text: "[First Name], [Last Name]", italics: true }), new TextRun(") before sending, and confirm Diana’s exact title.")]),
      bullet("Subject lines and preview text are provided for each email. Copy the body text straight into your email platform."),

      new Paragraph({ children: [new PageBreak()] }),

      // ================= EMAIL 1 =================
      emailHeading("Email 1 — The Alert"),
      sendNote("Suggested send: about one week before launch (e.g. Monday, June 23, 2026)"),
      meta("Subject:", "Something new is coming to woodlandhillscc.net 🎉"),
      meta("Preview text:", "Our brand-new Chamber website goes live July 1."),
      rule(),

      body("Dear [First Name],"),
      body("I’m thrilled to share some news our team has been working hard on. On Tuesday, July 1, 2026, the West Valley Warner Center Chamber of Commerce is launching a completely rebuilt website."),
      rich([
        new TextRun("The address stays exactly the same, "),
        url(),
        new TextRun(", but almost everything behind it is new: a faster, cleaner design, and a set of tools built to help your business get found and stay connected."),
      ]),
      body("A few of the things you’ll be able to do:"),
      bullet([new TextRun({ text: "Browse the new Member Directory", bold: true }), new TextRun(" and make sure your own listing shines")]),
      bullet([new TextRun({ text: "Ask Wendy", bold: true }), new TextRun(", our new AI Chamber Concierge, who can answer questions and point visitors straight to member businesses")]),
      bullet([new TextRun({ text: "See every Chamber event", bold: true }), new TextRun(" on a live calendar and register online")]),
      bullet([new TextRun({ text: "Post to the Jobs Board, share Member Deals,", bold: true }), new TextRun(" and connect on the Community Board")]),
      bullet([new TextRun({ text: "Explore Community Guides", bold: true }), new TextRun(" and visitor resources for the West Valley and Warner Center")]),
      bullet([new TextRun("Read the latest in "), new TextRun({ text: "Biz Buzz,", bold: true }), new TextRun(" our news and member-spotlight section")]),
      bullet([new TextRun("Manage your own listing anytime through your "), new TextRun({ text: "Member Portal", bold: true })]),
      rich([
        new TextRun("One important note for the launch: we’ve "),
        new TextRun({ text: "imported your existing account,", bold: true }),
        new TextRun(" so your business information carries over automatically. When the new site goes live, we’ll ask everyone to set a fresh password (more on that next week)."),
      ]),
      rich([
        new TextRun("The new site is being designed and managed for the Chamber by "),
        new TextRun({ text: "Michael Bowers of Heed AI Solutions.", bold: true }),
      ]),
      body("Watch your inbox over the next several days. I can’t wait for you to see it."),
      ...sig(["Warm regards,", "Diana [Last Name]", "Executive Director", "West Valley Warner Center Chamber of Commerce"]),

      new Paragraph({ children: [new PageBreak()] }),

      // ================= EMAIL 2 =================
      emailHeading("Email 2 — The Reminder"),
      sendNote("Suggested send: the day before launch (Monday, June 30, 2026)"),
      meta("Subject:", "Tomorrow: our new website goes live"),
      meta("Preview text:", "A quick heads-up and one thing to do when it launches."),
      rule(),

      body("Dear [First Name],"),
      rich([
        new TextRun("Just a quick reminder, our new Chamber website launches tomorrow, Tuesday, July 1, 2026, at the same address you already know: "),
        url(),
        new TextRun("."),
      ]),
      body("When you visit tomorrow, here’s the one thing I’d ask you to do:"),
      rich([
        new TextRun({ text: "Update your password. ", bold: true }),
        new TextRun("We’ve carried your existing account over to the new site, including your legacy login. For your security, please reset your password the first time you sign in. Just go to the Member Login page, choose "),
        new TextRun({ text: "“Forgot password,”", bold: true }),
        new TextRun(" and follow the link we email you to create a new one."),
      ]),
      body("Once you’re in, take a minute to:"),
      bullet([new TextRun("Review your "), new TextRun({ text: "directory listing", bold: true }), new TextRun(" and update your description, hours, photo, and links")]),
      bullet([new TextRun("Explore the new "), new TextRun({ text: "events calendar", bold: true }), new TextRun(" and register for what’s coming up")]),
      bullet([new TextRun("Try "), new TextRun({ text: "Ask Wendy,", bold: true }), new TextRun(" our AI Chamber Concierge")]),
      bullet([new TextRun("Check out the "), new TextRun({ text: "Jobs Board, Member Deals,", bold: true }), new TextRun(" and "), new TextRun({ text: "Community Guides", bold: true })]),
      rich([
        new TextRun("Everything has been rebuilt and is managed for us by "),
        new TextRun({ text: "Michael Bowers of Heed AI Solutions,", bold: true }),
        new TextRun(" and his team will be on hand through launch if anything needs attention."),
      ]),
      body("See you on the new site tomorrow!"),
      ...sig(["Warm regards,", "Diana [Last Name]", "Executive Director", "West Valley Warner Center Chamber of Commerce"]),

      new Paragraph({ children: [new PageBreak()] }),

      // ================= EMAIL 3 =================
      emailHeading("Email 3 — We’re Live"),
      sendNote("Suggested send: launch morning (Tuesday, July 1, 2026)"),
      meta("Subject:", "We’re live! Welcome to the new woodlandhillscc.net 🚀"),
      meta("Preview text:", "Sign in, reset your password, and explore everything that’s new."),
      rule(),

      body("Dear [First Name],"),
      rich([
        new TextRun("It’s official, our brand-new Chamber website is now live at "),
        url(),
        new TextRun("."),
      ]),
      body("Go take a look, and while you’re there, please do these two quick things:"),
      rich([
        new TextRun({ text: "1. Sign in and update your password. ", bold: true }),
        new TextRun("Your account moved over with us, including your previous login. For your security, head to Member Login, click "),
        new TextRun({ text: "“Forgot password,”", bold: true }),
        new TextRun(" and set a new one. It takes about a minute."),
      ]),
      rich([
        new TextRun({ text: "2. Check your directory listing. ", bold: true }),
        new TextRun("Make sure your business name, description, hours, photo, website, and contact details are exactly how you want potential customers to see them."),
      ]),
      body("While you explore, here’s what’s new:"),
      bullet([new TextRun({ text: "Member Directory", bold: true }), new TextRun(" that helps customers find you")]),
      bullet([new TextRun({ text: "Ask Wendy,", bold: true }), new TextRun(" our AI Chamber Concierge, answering questions 24/7 and recommending member businesses")]),
      bullet([new TextRun({ text: "Live events calendar", bold: true }), new TextRun(" with online registration")]),
      bullet([new TextRun({ text: "Jobs Board", bold: true }), new TextRun(" and "), new TextRun({ text: "Member Deals", bold: true }), new TextRun(" to promote your openings and offers")]),
      bullet([new TextRun({ text: "Community Guides", bold: true }), new TextRun(" and visitor resources for the West Valley and Warner Center")]),
      bullet([new TextRun({ text: "Biz Buzz", bold: true }), new TextRun(" news and member spotlights")]),
      bullet([new TextRun("Available in "), new TextRun({ text: "English and Spanish,", bold: true }), new TextRun(" with built-in accessibility tools for every visitor")]),
      rich([
        new TextRun("The site was designed and is managed for the Chamber by "),
        new TextRun({ text: "Michael Bowers of Heed AI Solutions.", bold: true }),
        new TextRun(" If you run into any trouble signing in or updating your listing, just reply to this email and we’ll help you right away."),
      ]),
      body("Thank you for being part of our Chamber community. Here’s to what’s next!"),
      ...sig(["Warm regards,", "Diana [Last Name]", "Executive Director", "West Valley Warner Center Chamber of Commerce"]),
    ],
  }],
});

const outPath = process.argv[2] || "WVWCCC-Website-Launch-Emails.docx";
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  console.log("wrote " + outPath + " (" + buf.length + " bytes)");
});

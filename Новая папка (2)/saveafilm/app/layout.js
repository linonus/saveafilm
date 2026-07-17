import './globals.css';

export const metadata = {
  title: 'Save a Film',
  description: 'Личная коллекция фильмов и сериалов',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <head>
        <script src="https://telegram.org/js/telegram-web-app.js" async></script>
      </head>
      <body>{children}</body>
    </html>
  );
}

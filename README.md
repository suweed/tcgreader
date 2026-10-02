<a name="readme-top"></a>

[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]
[![LinkedIn][linkedin-shield]][linkedin-url]

<!-- PROJECT LOGO -->
<br />
<div align="center">
    <a href="https://github.com/suweed/tcgreader">
        <img src="public/icons/avatarSelfie.png" alt="Logo" width="80" height="80">
    </a>
    <h3 align="center">TCG Reader</h3>
    <p align="center">
        Aplicación web para gestión de colección, escaneo OCR de cartas One Piece TCG, reconocimiento visual con OpenCV y consulta de precios en tiempo real
        <br />
        <a href="https://github.com/suweed/tcgreader"><strong>Explore the docs »</strong></a>
        <br />
        <br />
        <a href="https://github.com/suweed/tcgreader">View Demo</a>
        ·
        <a href="https://github.com/suweed/tcgreader/issues">Report Bug</a>
        ·
        <a href="https://github.com/suweed/tcgreader/issues">Request Feature</a>
    </p>
</div>

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li><a href="#contact">Contact</a></li>
  </ol>
</details>

<!-- ABOUT THE PROJECT -->
## About The Project

![Screen Shot][product-screenshot]

Plataforma integral para coleccionistas y jugadores de One Piece Card Game (OP-TCG). Permite explorar sets completos en inglés y japonés, administrar el inventario personal con cantidades y condiciones, consultar precios de mercado actualizados vía TCGPlayer/OPTCG API con conversión de divisas (USD / MXN), y escanear cartas físicas mediante la cámara web usando reconocimiento de texto por OCR (Google Cloud Vision) y comparación de arte con OpenCV (ORB feature matching) para clasificar automáticamente variantes y artes alternativos.

<p align="right">(<a href="#readme-top">volver al principio</a>)</p>

### Built With

* [![React][React]][React-url]
* [![TypeScript][TypeScript]][TypeScript-url]
* [![Vite][Vite]][Vite-url]
* [![TailwindCSS][TailwindCSS]][TailwindCSS-url]
* [![Node][Node]][Node-url]
* [![Postgresql][Postgresql]][Postgresql-url]
* [![OpenCV][OpenCV]][OpenCV-url]
* [![Vercel][Vercel]][Vercel-url]

<p align="right">(<a href="#readme-top">volver al principio</a>)</p>

<!-- GETTING STARTED -->
## Getting Started

Proyecto con frontend en React + TypeScript (Vite + Tailwind CSS), API serverless en Node.js/TypeScript y base de datos PostgreSQL (Neon / Vercel Postgres) con soporte para fallback local en SQLite.

### Prerequisites

* node (v20 o v22 recomendado)
  - https://nodejs.org/es
* npm
  - https://www.npmjs.com/
* postgresql (Neon o local)
  - https://www.postgresql.org/

  ```
  npm install
  npm run build
  ```

### Installation

1. Clone the repo
   ```
   git clone git@github.com:suweed/tcgreader.git
   ```
2. Install NPM packages (root y frontend)
   ```
   npm install
   cd frontend && npm install && cd ..
   ```
3. Config environment variables
   ```
   Create file .env
   ```
   Configura la conexión a PostgreSQL (opcional en local con SQLite, obligatorio en Vercel/Neon):
   ```
   DATABASE_URL="postgresql://<user>:<password>@<host>/<dbname>?sslmode=require"
   ```
4. Migrate Data to PostgreSQL
   ```
   npm run migrate
   ```
5. Start development servers
   - Terminal 1 (Backend API):
     ```
     npm run dev:api
     ```
   - Terminal 2 (Frontend React):
     ```
     npm run dev:frontend
     ```
   Frontend disponible en `http://localhost:5173/` y API en `http://localhost:3000/api`.

<p align="right">(<a href="#readme-top">volver al principio</a>)</p>

<!-- LICENSE -->
## License

Distribuido bajo la licencia MIT. Consulte `LICENSE` para obtener más información.

<p align="right">(<a href="#readme-top">volver al principio</a>)</p>

<!-- CONTACT -->
## Contact

Jesús Cardozo - [@dRsUgAr1221](https://twitter.com/dRsUgAr1221) - gsuskr2o@gmail.com

Project Link: [https://github.com/suweed/tcgreader](https://github.com/suweed/tcgreader)

<p align="right">(<a href="#readme-top">volver al principio</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
[contributors-shield]: https://img.shields.io/github/contributors/suweed/tcgreader.svg?style=for-the-badge
[contributors-url]: https://github.com/suweed/tcgreader/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/suweed/tcgreader.svg?style=for-the-badge
[forks-url]: https://github.com/suweed/tcgreader/network/members
[stars-shield]: https://img.shields.io/github/stars/suweed/tcgreader.svg?style=for-the-badge
[stars-url]: https://github.com/suweed/tcgreader/stargazers
[license-shield]: https://img.shields.io/github/license/suweed/tcgreader.svg?style=for-the-badge
[license-url]: https://github.com/suweed/tcgreader/blob/main/LICENSE
[issues-shield]: https://img.shields.io/github/issues/suweed/tcgreader.svg?style=for-the-badge
[issues-url]: https://github.com/suweed/tcgreader/issues
[linkedin-shield]: https://img.shields.io/badge/-LinkedIn-black.svg?style=for-the-badge&logo=linkedin&colorB=555
[linkedin-url]: https://linkedin.com/in/gsuskr2o
[product-screenshot]: public/images/screen.jpg
[React]: https://img.shields.io/badge/react-20232A?style=for-the-badge&logo=react
[React-url]: https://react.dev/
[TypeScript]: https://img.shields.io/badge/typescript-20232A?style=for-the-badge&logo=typescript
[TypeScript-url]: https://www.typescriptlang.org/
[Vite]: https://img.shields.io/badge/vite-20232A?style=for-the-badge&logo=vite
[Vite-url]: https://vitejs.dev/
[TailwindCSS]: https://img.shields.io/badge/tailwindcss-20232A?style=for-the-badge&logo=tailwindcss
[TailwindCSS-url]: https://tailwindcss.com/
[Node]: https://img.shields.io/badge/node.js-20232A?style=for-the-badge&logo=node.js
[Node-url]: https://nodejs.org/es
[Postgresql]: https://img.shields.io/badge/postgresql-20232A?style=for-the-badge&logo=postgresql
[Postgresql-url]: https://www.postgresql.org/
[OpenCV]: https://img.shields.io/badge/opencv-20232A?style=for-the-badge&logo=opencv
[OpenCV-url]: https://opencv.org/
[Vercel]: https://img.shields.io/badge/vercel-20232A?style=for-the-badge&logo=vercel
[Vercel-url]: https://vercel.com/

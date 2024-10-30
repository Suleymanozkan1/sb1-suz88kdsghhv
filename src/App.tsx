import React from 'react';
import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { About } from './components/About';
import { Tokenomics } from './components/Tokenomics';
import { Join } from './components/Join';
import { Story } from './components/Story';
import { BambooBackground } from './components/BambooBackground';

function App() {
  return (
    <div className="min-h-screen relative">
      <BambooBackground />
      <Header />
      <main>
        <Hero />
        <About />
        <Tokenomics />
        <Join />
        <Story />
      </main>
    </div>
  );
}

export default App;
import React from 'react';

export function BambooBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      {/* Natural Bamboo Forest Background */}
      <div 
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: `url('https://images.unsplash.com/photo-1564349683136-77e08dba1ef7?ixlib=rb-1.2.1&auto=format&fit=crop&w=2072&q=80')`
        }}
      />

      {/* Animated Bamboo Stalks */}
      {[...Array(10)].map((_, i) => (
        <div
          key={i}
          className="absolute bottom-0 swaying"
          style={{
            left: `${i * 10 + Math.random() * 5}%`,
            animationDelay: `${i * 0.3}s`,
            height: `${30 + Math.random() * 20}%`, // Reduced height to be shorter
            transform: 'rotate(-2deg)',
            transformOrigin: 'bottom center',
            opacity: '0.4'
          }}
        >
          {/* Main Bamboo Stalk */}
          <div
            className="absolute bottom-0 w-6"
            style={{
              height: '100%',
              background: 'linear-gradient(90deg, #065f46 0%, #047857 50%, #065f46 100%)',
              borderRadius: '4px'
            }}
          >
            {/* Bamboo Nodes */}
            {[...Array(5)].map((_, j) => ( // Reduced number of nodes
              <div
                key={j}
                className="absolute w-full"
                style={{
                  top: `${j * 20}%`, // Adjusted spacing
                  height: '8px',
                  background: '#065f46',
                  borderTop: '2px solid #047857',
                  borderBottom: '2px solid #047857',
                  borderRadius: '2px',
                  transform: 'scale(1.1)'
                }}
              />
            ))}
          </div>

          {/* Bamboo Leaves */}
          {[...Array(3)].map((_, j) => ( // Reduced number of leaves
            <React.Fragment key={j}>
              {/* Left Leaves */}
              <div
                className="absolute"
                style={{
                  top: `${j * 30}%`, // Adjusted spacing
                  left: '-40px',
                  width: '40px',
                  height: '80px', // Reduced leaf size
                  background: 'linear-gradient(135deg, #059669 0%, transparent 100%)',
                  clipPath: 'polygon(0 50%, 100% 0, 100% 100%)',
                  transform: 'rotate(-30deg)',
                  transformOrigin: 'right center',
                  animation: `sway ${3 + Math.random()}s ease-in-out infinite`,
                  animationDelay: `${j * 0.2}s`
                }}
              />
              {/* Right Leaves */}
              <div
                className="absolute"
                style={{
                  top: `${j * 30 + 10}%`, // Adjusted spacing
                  right: '-40px',
                  width: '40px',
                  height: '80px', // Reduced leaf size
                  background: 'linear-gradient(225deg, #059669 0%, transparent 100%)',
                  clipPath: 'polygon(0 0, 0 100%, 100% 50%)',
                  transform: 'rotate(30deg)',
                  transformOrigin: 'left center',
                  animation: `sway ${3 + Math.random()}s ease-in-out infinite`,
                  animationDelay: `${j * 0.2 + 0.1}s`
                }}
              />
            </React.Fragment>
          ))}
        </div>
      ))}
    </div>
  );
}
const ngrok = require('ngrok');

async function startTunnel() {
  try {
    console.log('🚀 Starting ngrok tunnel...');
    
    // Configure ngrok with proper options
    const url = await ngrok.connect({
      addr: 3000,
      proto: 'http',
      region: 'us', // or 'eu', 'ap', 'au', 'sa', 'jp', 'in'
      onStatusChange: (status) => {
        console.log('📡 Tunnel status:', status);
      },
      onLogEvent: (data) => {
        console.log('📋 Tunnel log:', data);
      }
    });
    
    console.log(`✅ Tunnel active: ${url}`);
    console.log(`🔗 Webhook URL: ${url}/webhook`);
    console.log('\n📋 Use this URL for your Helius webhook configuration');
    console.log('Press Ctrl+C to stop the tunnel');
    
    // Keep the process running
    process.on('SIGINT', async () => {
      console.log('\n🛑 Stopping ngrok tunnel...');
      await ngrok.disconnect();
      await ngrok.kill();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Failed to start tunnel:', error.message);
    console.log('\n💡 Troubleshooting:');
    console.log('1. Make sure ngrok is properly installed');
    console.log('2. Check if port 3000 is available');
    console.log('3. Try running: npx ngrok http 3000');
    process.exit(1);
  }
}

startTunnel();
